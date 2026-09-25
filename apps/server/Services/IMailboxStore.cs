using System.Collections.Concurrent;

namespace Telepath.Server.Services;

public record MailboxMessage(string SenderPublicKey, string Payload);

public interface IMailboxStore
{
    void Enqueue(string recipientPublicKey, string senderPublicKey, string payload);
    IReadOnlyList<MailboxMessage> DequeueAll(string recipientPublicKey);
}

// In-memory placeholder, same caveat as the other stores here: swap for a
// persistent store before scaling past one instance. Holds ciphertext only
// — the server never sees plaintext — and only until the recipient's next
// Announce, not as a message archive.
public class InMemoryMailboxStore : IMailboxStore
{
    private const int MaxQueuedPerRecipient = 200;
    private readonly ConcurrentDictionary<string, ConcurrentQueue<MailboxMessage>> _mailboxes = new();

    public void Enqueue(string recipientPublicKey, string senderPublicKey, string payload)
    {
        var queue = _mailboxes.GetOrAdd(recipientPublicKey, _ => new ConcurrentQueue<MailboxMessage>());
        queue.Enqueue(new MailboxMessage(senderPublicKey, payload));
        while (queue.Count > MaxQueuedPerRecipient && queue.TryDequeue(out _))
        {
        }
    }

    public IReadOnlyList<MailboxMessage> DequeueAll(string recipientPublicKey)
    {
        if (!_mailboxes.TryRemove(recipientPublicKey, out var queue)) return Array.Empty<MailboxMessage>();
        return queue.ToArray();
    }
}
