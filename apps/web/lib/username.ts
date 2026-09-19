const STORAGE_KEY = "telepath.username.v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

export function getOwnUsername(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

// Claims a username, or — if it's already ours — just refreshes the
// connectionId the server has on file for it. Call this again after every
// reconnect so contacts who added you by username can still reach you.
export async function claimUsername(
  username: string,
  publicKey: string,
  connectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${API_URL}/api/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, publicKey, connectionId }),
  });
  if (res.status === 409) return { ok: false, error: "Ese username ya está en uso." };
  if (!res.ok) return { ok: false, error: "Username inválido: 3-20 caracteres, letras/números/_." };
  localStorage.setItem(STORAGE_KEY, username.trim().toLowerCase());
  return { ok: true };
}

export async function lookupUsername(
  username: string
): Promise<{ publicKey: string; connectionId: string } | null> {
  const res = await fetch(`${API_URL}/api/users/${encodeURIComponent(username.trim().toLowerCase())}`);
  if (!res.ok) return null;
  return res.json();
}
