using System.Collections.Concurrent;
using System.Text;
using NSec.Cryptography;

namespace Telepath.Server.Services;

public interface IPresenceDirectory
{
    // Registers identityPublicKey as reachable at connectionId for the
    // caller, or refreshes the connectionId on reconnect. signature must be
    // a valid Ed25519 signature by signingPublicKey over
    // "announce:{identityPublicKey}:{connectionId}" — same ownership-proof
    // pattern as IUsernameDirectory, needed so a stranger can't redirect
    // someone else's messages to their own connection just by announcing a
    // public key they don't hold the matching private key for.
    bool Announce(string identityPublicKey, string connectionId, string signingPublicKey, string signature);
    string? GetConnectionId(string identityPublicKey);
    string? GetIdentityPublicKey(string connectionId);
    void RemoveConnection(string connectionId);
}

// In-memory placeholder, same caveat as the other stores here: swap for a
// persistent/shared store before scaling past one instance.
public class InMemoryPresenceDirectory : IPresenceDirectory
{
    private class Entry
    {
        public required string SigningPublicKey;
        public required string ConnectionId;
    }

    private readonly ConcurrentDictionary<string, Entry> _byIdentity = new();
    private readonly ConcurrentDictionary<string, string> _connectionToIdentity = new();

    public bool Announce(string identityPublicKey, string connectionId, string signingPublicKey, string signature)
    {
        if (!VerifyOwnership(identityPublicKey, connectionId, signingPublicKey, signature)) return false;

        var entry = _byIdentity.GetOrAdd(
            identityPublicKey,
            _ => new Entry { SigningPublicKey = signingPublicKey, ConnectionId = connectionId });

        lock (entry)
        {
            if (entry.SigningPublicKey != signingPublicKey) return false;
            entry.ConnectionId = connectionId;
        }
        _connectionToIdentity[connectionId] = identityPublicKey;
        return true;
    }

    public string? GetConnectionId(string identityPublicKey) =>
        _byIdentity.TryGetValue(identityPublicKey, out var entry) ? entry.ConnectionId : null;

    public string? GetIdentityPublicKey(string connectionId) =>
        _connectionToIdentity.TryGetValue(connectionId, out var identity) ? identity : null;

    public void RemoveConnection(string connectionId)
    {
        if (!_connectionToIdentity.TryRemove(connectionId, out var identityPublicKey)) return;
        if (!_byIdentity.TryGetValue(identityPublicKey, out var entry)) return;
        lock (entry)
        {
            // Only clear if this connection is still the current one — the
            // client may have already reconnected with a new connectionId
            // and announced again before this disconnect event ran.
            if (entry.ConnectionId == connectionId)
            {
                _byIdentity.TryRemove(identityPublicKey, out _);
            }
        }
    }

    private static bool VerifyOwnership(string identityPublicKey, string connectionId, string signingPublicKeyBase64, string signatureBase64)
    {
        try
        {
            var publicKeyBytes = Convert.FromBase64String(signingPublicKeyBase64);
            var signatureBytes = Convert.FromBase64String(signatureBase64);
            var algorithm = SignatureAlgorithm.Ed25519;
            var publicKey = PublicKey.Import(algorithm, publicKeyBytes, KeyBlobFormat.RawPublicKey);
            var message = Encoding.UTF8.GetBytes($"announce:{identityPublicKey}:{connectionId}");
            return algorithm.Verify(publicKey, message, signatureBytes);
        }
        catch (FormatException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
