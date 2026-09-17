using Microsoft.AspNetCore.SignalR;

namespace Telepath.Server.Hubs;

/// <summary>
/// Relays already-encrypted message blobs between clients. The server never
/// sees plaintext: payload is ciphertext produced client-side (E2EE).
/// </summary>
public class ChatHub : Hub
{
    public async Task SendEncryptedMessage(string recipientConnectionId, string ciphertextPayload)
    {
        await Clients.Client(recipientConnectionId)
            .SendAsync("ReceiveEncryptedMessage", Context.ConnectionId, ciphertextPayload);
    }
}
