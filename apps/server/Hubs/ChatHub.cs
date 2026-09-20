using Microsoft.AspNetCore.SignalR;
using Telepath.Server.Services;

namespace Telepath.Server.Hubs;

/// <summary>
/// Relays already-encrypted message blobs between clients, addressed by
/// each side's identity public key rather than the ephemeral SignalR
/// connection id — so routing survives reconnects. The server never sees
/// plaintext: payload is ciphertext produced client-side (E2EE). A message
/// to a recipient with no live connection is queued in the mailbox and
/// flushed on their next Announce, instead of being silently dropped.
/// </summary>
public class ChatHub(IPresenceDirectory presence, IMailboxStore mailbox) : Hub
{
    // Called on connect and again after every reconnect, before sending or
    // expecting to receive anything.
    public async Task<bool> Announce(string identityPublicKey, string signingPublicKey, string signature)
    {
        var ok = presence.Announce(identityPublicKey, Context.ConnectionId, signingPublicKey, signature);
        if (!ok) return false;

        foreach (var queued in mailbox.DequeueAll(identityPublicKey))
        {
            await Clients.Caller.SendAsync("ReceiveEncryptedMessage", queued.SenderPublicKey, queued.Payload);
        }
        return true;
    }

    public async Task SendEncryptedMessage(string recipientPublicKey, string ciphertextPayload)
    {
        var senderPublicKey = presence.GetIdentityPublicKey(Context.ConnectionId);
        if (senderPublicKey is null) return; // hasn't announced yet — nothing to attribute this send to

        var recipientConnectionId = presence.GetConnectionId(recipientPublicKey);
        if (recipientConnectionId is not null)
        {
            await Clients.Client(recipientConnectionId).SendAsync("ReceiveEncryptedMessage", senderPublicKey, ciphertextPayload);
            return;
        }

        mailbox.Enqueue(recipientPublicKey, senderPublicKey, ciphertextPayload);
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        presence.RemoveConnection(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
