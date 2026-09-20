import { getSodium } from "./sodium";
import { RatchetSession } from "./doubleRatchet";
import type { KeyPair } from "./identity";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function generateKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

async function main() {
  const sodium = await getSodium();
  const alice = await generateKeyPair();
  const bob = await generateKeyPair();

  const sharedSecretRaw = sodium.crypto_scalarmult(alice.privateKey, bob.publicKey);
  const sharedSecretCheck = sodium.crypto_scalarmult(bob.privateKey, alice.publicKey);
  assert(
    Buffer.from(sharedSecretRaw).equals(Buffer.from(sharedSecretCheck)),
    "both sides derive the same ECDH shared secret"
  );
  const sharedSecret = sodium.crypto_generichash(32, sharedSecretRaw, null);
  const ad = new Uint8Array([1, 2, 3]);

  // Alice is the initiator (knows Bob's static key up front), Bob is the responder.
  const aliceSession = await RatchetSession.initAsInitiator(sharedSecret, bob.publicKey, ad);
  const bobSession = await RatchetSession.initAsResponder(sharedSecret, bob, ad);

  const msg1 = await aliceSession.encrypt("hola bob");
  const plain1 = await bobSession.decrypt(msg1);
  assert(plain1 === "hola bob", "bob decrypts alice's first message");

  const msg2 = await bobSession.encrypt("hola alice");
  const plain2 = await aliceSession.decrypt(msg2);
  assert(plain2 === "hola alice", "alice decrypts bob's reply (after DH ratchet step)");

  const msg3 = await aliceSession.encrypt("segundo mensaje");
  const msg4 = await aliceSession.encrypt("tercer mensaje");
  const plain4 = await bobSession.decrypt(msg4);
  const plain3 = await bobSession.decrypt(msg3);
  assert(plain4 === "tercer mensaje", "bob decrypts out-of-order message (skipped keys)");
  assert(plain3 === "segundo mensaje", "bob decrypts the earlier skipped message afterwards");

  const restored = RatchetSession.fromJSON(aliceSession.toJSON());
  const msg5 = await restored.encrypt("post-serializacion");
  const plain5 = await bobSession.decrypt(msg5);
  assert(plain5 === "post-serializacion", "session survives toJSON/fromJSON round-trip");

  // msg1 uses a stale dh value at this point, so decrypting it would trigger
  // another DH ratchet step instead of isolating ciphertext-only tampering.
  // Encrypt a fresh message against the current ratchet state instead.
  let tamperFailed = false;
  const victim = await restored.encrypt("mensaje intacto");
  try {
    const tampered = { ...victim, ciphertext: victim.ciphertext.slice(0, -4) + "abcd" };
    await bobSession.decrypt(tampered);
  } catch {
    tamperFailed = true;
  }
  assert(tamperFailed, "tampered ciphertext is rejected");
  assert(
    (await bobSession.decrypt(victim)) === "mensaje intacto",
    "session still works after a rejected message"
  );

  console.log("\nAll ratchet self-tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
