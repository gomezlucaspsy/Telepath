import { getSodium } from "./sodium";
import { concatBytes } from "./bytes";

// HMAC-SHA256(key, message) — libsodium requires a 32-byte key here.
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return new Uint8Array(sodium.crypto_auth_hmacsha256(data, key));
}

// HKDF (RFC 5869) built from HMAC-SHA256: Extract-then-Expand.
export async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const blocks: Uint8Array[] = [];
  let prev: Uint8Array = new Uint8Array(0);
  let counter = 1;
  let generated = 0;
  while (generated < length) {
    const input = concatBytes(prev, info, new Uint8Array([counter]));
    const block = await hmac(prk, input);
    blocks.push(block);
    generated += block.length;
    prev = block;
    counter++;
  }
  return concatBytes(...blocks).slice(0, length);
}

const ROOT_INFO = new TextEncoder().encode("TelepathRatchetRoot");

// Root ratchet step: derive a fresh (rootKey, chainKey) pair from the
// current root key and a new Diffie-Hellman output.
export async function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): Promise<{ rootKey: Uint8Array; chainKey: Uint8Array }> {
  const output = await hkdf(rootKey, dhOutput, ROOT_INFO, 64);
  return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
}

// Symmetric-chain ratchet step: derive the next chain key and a message key.
export async function kdfChainKey(
  chainKey: Uint8Array
): Promise<{ chainKey: Uint8Array; messageKey: Uint8Array }> {
  const messageKey = await hmac(chainKey, new Uint8Array([0x01]));
  const nextChainKey = await hmac(chainKey, new Uint8Array([0x02]));
  return { chainKey: nextChainKey, messageKey };
}
