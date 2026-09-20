import { getSodium } from "./sodium";
import { bytesToBase64, base64ToBytes } from "./bytes";

const STORAGE_KEY = "telepath.identityKeyPair.v1";

export type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

export async function getOrCreateIdentityKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
      const publicKey = base64ToBytes(parsed.publicKey);
      const privateKey = base64ToBytes(parsed.privateKey);
      // Valid JSON/base64 can still decode to the wrong number of bytes —
      // that wouldn't throw here, only later inside crypto_scalarmult with
      // a much more confusing error. Check lengths up front instead.
      if (
        publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
        privateKey.length !== sodium.crypto_box_SECRETKEYBYTES
      ) {
        throw new Error("bad key length");
      }
      return { publicKey, privateKey };
    } catch {
      // Every existing conversation is bound to this key's public half, so
      // silently regenerating it would silently orphan all of them with no
      // way for the user to know why. Surface it instead of guessing.
      throw new Error("CORRUPTED_IDENTITY_KEY");
    }
  }
  const keyPair = sodium.crypto_box_keypair();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      publicKey: bytesToBase64(keyPair.publicKey),
      privateKey: bytesToBase64(keyPair.privateKey),
    })
  );
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export function publicKeyToBase64(publicKey: Uint8Array): string {
  return bytesToBase64(publicKey);
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  return base64ToBytes(b64);
}

const SIGNING_STORAGE_KEY = "telepath.identitySigningKeyPair.v1";

export type SigningKeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

// Separate Ed25519 signing identity, used only to prove possession of the
// private key when claiming/refreshing a username (see lib/username.ts).
// The main identity keypair above is an X25519 box keypair and can't sign.
export async function getOrCreateSigningKeyPair(): Promise<SigningKeyPair> {
  const sodium = await getSodium();
  const stored = localStorage.getItem(SIGNING_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
      const publicKey = base64ToBytes(parsed.publicKey);
      const privateKey = base64ToBytes(parsed.privateKey);
      if (
        publicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES ||
        privateKey.length !== sodium.crypto_sign_SECRETKEYBYTES
      ) {
        throw new Error("bad key length");
      }
      return { publicKey, privateKey };
    } catch {
      // Unlike the main identity key, this only gates username claims —
      // regenerating it is low blast radius, so it's safe to self-heal
      // instead of permanently blocking every future username claim.
      localStorage.removeItem(SIGNING_STORAGE_KEY);
    }
  }
  const keyPair = sodium.crypto_sign_keypair();
  localStorage.setItem(
    SIGNING_STORAGE_KEY,
    JSON.stringify({
      publicKey: bytesToBase64(keyPair.publicKey),
      privateKey: bytesToBase64(keyPair.privateKey),
    })
  );
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}
