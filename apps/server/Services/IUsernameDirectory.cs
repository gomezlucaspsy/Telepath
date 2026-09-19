using System.Collections.Concurrent;
using Telepath.Server.Models;

namespace Telepath.Server.Services;

public interface IUsernameDirectory
{
    // Claims the username for publicKey, or — if already owned by that same
    // key — refreshes its connectionId (this is how a client re-announces
    // itself as reachable after a SignalR reconnect). Returns false if the
    // username is already owned by a different key.
    bool Register(string username, string publicKey, string connectionId);
    UsernameRegistration? Lookup(string username);
}

// In-memory placeholder, same caveat as InMemoryPairingStore: swap for a
// persistent store before production, and note that "ownership" here is
// only as strong as "whoever called /register first" — there's no signature
// proving the caller holds the identity's private key. Fine for this stage
// since the whole client is unauthenticated by design; worth hardening
// alongside real accounts later.
public class InMemoryUsernameDirectory : IUsernameDirectory
{
    private readonly ConcurrentDictionary<string, UsernameRegistration> _byUsername = new();

    public bool Register(string username, string publicKey, string connectionId)
    {
        var key = Normalize(username);
        var entry = _byUsername.GetOrAdd(
            key,
            _ => new UsernameRegistration { Username = key, PublicKey = publicKey, ConnectionId = connectionId });

        if (entry.PublicKey != publicKey) return false;

        entry.ConnectionId = connectionId;
        return true;
    }

    public UsernameRegistration? Lookup(string username) =>
        _byUsername.TryGetValue(Normalize(username), out var entry) ? entry : null;

    private static string Normalize(string username) => username.Trim().ToLowerInvariant();
}
