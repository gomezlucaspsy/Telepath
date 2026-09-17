import * as signalR from "@microsoft/signalr";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://localhost:7218";

export type IncomingMessage = { senderConnectionId: string; payload: string };

export async function connectChatHub(
  onMessage: (msg: IncomingMessage) => void
): Promise<signalR.HubConnection> {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/chat`)
    .withAutomaticReconnect()
    .build();

  connection.on("ReceiveEncryptedMessage", (senderConnectionId: string, payload: string) => {
    onMessage({ senderConnectionId, payload });
  });

  await connection.start();
  return connection;
}

export async function sendEncrypted(
  connection: signalR.HubConnection,
  recipientConnectionId: string,
  payload: string
): Promise<void> {
  await connection.invoke("SendEncryptedMessage", recipientConnectionId, payload);
}
