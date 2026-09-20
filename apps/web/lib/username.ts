import { bytesToBase64 } from "./crypto/bytes";
import { getOrCreateSigningKeyPair, signWithIdentity } from "./crypto/identity";

const STORAGE_KEY = "telepath.username.v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

export function getOwnUsername(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

// Claims a username, or — if it's already ours — just refreshes the
// connectionId the server has on file for it. Call this again after every
// reconnect so contacts who added you by username can still reach you.
//
// Signs "{username}:{connectionId}" with our Ed25519 signing key so the
// server can verify we actually hold the private key, instead of trusting
// a PublicKey match — PublicKey is public information anyone can read back
// via lookupUsername, so it can't prove ownership on its own.
export async function claimUsername(
  username: string,
  publicKey: string,
  connectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const signingKeyPair = await getOrCreateSigningKeyPair();
  const normalized = username.trim().toLowerCase();
  const signature = await signWithIdentity(signingKeyPair, `${normalized}:${connectionId}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        publicKey,
        connectionId,
        signingPublicKey: bytesToBase64(signingKeyPair.publicKey),
        signature,
      }),
    });
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor. Probá de nuevo." };
  }
  if (res.status === 409) return { ok: false, error: "Ese username ya está en uso." };
  if (res.status === 400) return { ok: false, error: "Username inválido: 3-20 caracteres, letras/números/_." };
  if (!res.ok) return { ok: false, error: "No se pudo conectar con el servidor. Probá de nuevo." };
  localStorage.setItem(STORAGE_KEY, normalized);
  return { ok: true };
}

export async function lookupUsername(
  username: string
): Promise<{ publicKey: string; connectionId: string } | null> {
  try {
    const res = await fetch(`${API_URL}/api/users/${encodeURIComponent(username.trim().toLowerCase())}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
