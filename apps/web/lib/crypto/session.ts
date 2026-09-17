import { getSodium } from "./sodium";
import { RatchetSession } from "./doubleRatchet";
import { concatBytes } from "./bytes";
import type { KeyPair } from "./identity";

function comparePublicKeys(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Bootstraps a Double Ratchet session from two identity keypairs that were
// exchanged over the pairing channel. Both sides independently compute the
// same shared secret via X25519 ECDH; a deterministic tie-break (comparing
// public keys) decides who acts as the ratchet's initiator vs. responder,
// since the pairing exchange itself is symmetric.
export async function establishSession(
  ownIdentity: KeyPair,
  peerIdentityPublicKey: Uint8Array
): Promise<RatchetSession> {
  const sodium = await getSodium();
  const sharedSecretRaw = sodium.crypto_scalarmult(
    ownIdentity.privateKey,
    peerIdentityPublicKey
  );
  const sharedSecret = sodium.crypto_generichash(32, sharedSecretRaw, null);

  const associatedData =
    comparePublicKeys(ownIdentity.publicKey, peerIdentityPublicKey) < 0
      ? concatBytes(ownIdentity.publicKey, peerIdentityPublicKey)
      : concatBytes(peerIdentityPublicKey, ownIdentity.publicKey);

  const isInitiator = comparePublicKeys(ownIdentity.publicKey, peerIdentityPublicKey) > 0;

  if (isInitiator) {
    return RatchetSession.initAsInitiator(sharedSecret, peerIdentityPublicKey, associatedData);
  }

  // Responder ratchets with its own identity keypair as the initial DH key —
  // it will rotate to a fresh ephemeral key on the first message it receives.
  return RatchetSession.initAsResponder(sharedSecret, ownIdentity, associatedData);
}
