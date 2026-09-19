// Local, per-device conversation storage. The server never sees plaintext or
// conversation state, so "deleting a conversation" is purely a client-side
// operation — there is nothing to tell the server, and nothing for it to keep.

export type StoredMessage = { fromMe: boolean; text: string; at: number };

export type StoredConversation = {
  peerPublicKey: string; // base64 identity key — stable primary key for the conversation
  peerConnectionId: string | null; // last known SignalR id; goes stale on peer reconnect, routing-only
  label: string;
  createdAt: number;
  updatedAt: number;
  ratchetSessionJson: string;
  messages: StoredMessage[];
};

const INDEX_KEY = "telepath.conversations.index.v1";
const conversationKey = (peerPublicKey: string) => `telepath.conversation.${peerPublicKey}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(keys));
}

export function loadConversation(peerPublicKey: string): StoredConversation | null {
  const raw = localStorage.getItem(conversationKey(peerPublicKey));
  return raw ? (JSON.parse(raw) as StoredConversation) : null;
}

export function saveConversation(conv: StoredConversation): void {
  localStorage.setItem(conversationKey(conv.peerPublicKey), JSON.stringify(conv));
  const index = readIndex();
  if (!index.includes(conv.peerPublicKey)) {
    writeIndex([...index, conv.peerPublicKey]);
  }
}

export function listConversations(): StoredConversation[] {
  return readIndex()
    .map((key) => loadConversation(key))
    .filter((conv): conv is StoredConversation => conv !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Creates a fresh conversation, or re-keys an existing one after a re-pair —
// history and label survive a re-pair, only the ratchet session resets.
export function createConversation(params: {
  peerPublicKey: string;
  peerConnectionId: string;
  ratchetSessionJson: string;
}): StoredConversation {
  const existing = loadConversation(params.peerPublicKey);
  const now = Date.now();
  const conv: StoredConversation = {
    peerPublicKey: params.peerPublicKey,
    peerConnectionId: params.peerConnectionId,
    label: existing?.label ?? `Dispositivo ${params.peerPublicKey.slice(0, 6)}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ratchetSessionJson: params.ratchetSessionJson,
    messages: existing?.messages ?? [],
  };
  saveConversation(conv);
  return conv;
}

export function appendMessage(
  peerPublicKey: string,
  message: { fromMe: boolean; text: string },
  ratchetSessionJson: string
): StoredConversation | null {
  const conv = loadConversation(peerPublicKey);
  if (!conv) return null;
  conv.messages.push({ ...message, at: Date.now() });
  conv.ratchetSessionJson = ratchetSessionJson;
  conv.updatedAt = Date.now();
  saveConversation(conv);
  return conv;
}

// Best-effort local wipe: clear the key material and history before dropping
// the record, then remove it from the index. No network call — deleting a
// conversation never touches the server.
export function deleteConversation(peerPublicKey: string): void {
  localStorage.removeItem(conversationKey(peerPublicKey));
  writeIndex(readIndex().filter((key) => key !== peerPublicKey));
}
