import * as signalR from "@microsoft/signalr";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

// Messages are addressed by identity public key, not by the ephemeral
// SignalR connection id — that survives reconnects, so routing (and the
// server's offline mailbox) keeps working across them.
export type IncomingMessage = { senderPublicKey: string; payload: string };

export async function connectChatHub(
  onMessage: (msg: IncomingMessage) => void
): Promise<signalR.HubConnection> {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/chat`)
    .withAutomaticReconnect()
    .build();

  connection.on("ReceiveEncryptedMessage", (senderPublicKey: string, payload: string) => {
    onMessage({ senderPublicKey, payload });
  });

  await connection.start();
  return connection;
}

// Proves we hold the private key for identityPublicKey by signing
// "announce:{identityPublicKey}:{connectionId}" — required so a stranger
// can't redirect someone else's messages to their own connection just by
// announcing a public key they don't own (same reasoning as username
// claims in lib/username.ts). Call this once per connection and again
// after every reconnect, before sending or expecting to receive anything.
export async function announceIdentity(
  connection: signalR.HubConnection,
  identityPublicKey: string,
  signingPublicKey: string,
  signature: string
): Promise<boolean> {
  return connection.invoke<boolean>("Announce", identityPublicKey, signingPublicKey, signature);
}

export async function sendEncrypted(
  connection: signalR.HubConnection,
  recipientPublicKey: string,
  payload: string
): Promise<void> {
  await connection.invoke("SendEncryptedMessage", recipientPublicKey, payload);
}
