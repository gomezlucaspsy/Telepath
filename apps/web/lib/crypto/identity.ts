import { getSodium } from "./sodium";
import { bytesToBase64, base64ToBytes } from "./bytes";

const STORAGE_KEY = "telepath.identityKeyPair.v1";

export type KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

export async function getOrCreateIdentityKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
    return {
      publicKey: base64ToBytes(parsed.publicKey),
      privateKey: base64ToBytes(parsed.privateKey),
    };
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
