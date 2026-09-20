using System.Collections.Concurrent;
using System.Text;
using NSec.Cryptography;
using Telepath.Server.Models;

namespace Telepath.Server.Services;

public interface IUsernameDirectory
{
    // Claims the username for publicKey, or — if already owned by that same
    // key — refreshes its connectionId (this is how a client re-announces
    // itself as reachable after a SignalR reconnect). signature must be a
    // valid Ed25519 signature by signingPublicKey over "{username}:{connectionId}",
    // which is how the caller proves it actually holds the identity's private
    // key rather than merely knowing a PublicKey it read off the public
    // lookup endpoint. Returns false if the username is owned by a different
    // identity, or if the signature does not verify.
    bool Register(string username, string publicKey, string connectionId, string signingPublicKey, string signature);
    UsernameRegistration? Lookup(string username);
}

// In-memory placeholder, same caveat as InMemoryPairingStore: swap for a
// persistent store before production.
public class InMemoryUsernameDirectory : IUsernameDirectory
{
    private readonly ConcurrentDictionary<string, UsernameRegistration> _byUsername = new();

    public bool Register(string username, string publicKey, string connectionId, string signingPublicKey, string signature)
    {
        var key = Normalize(username);

        if (!VerifyOwnership(key, connectionId, signingPublicKey, signature)) return false;

        var entry = _byUsername.GetOrAdd(
            key,
            _ => new UsernameRegistration
            {
                Username = key,
                PublicKey = publicKey,
                ConnectionId = connectionId,
                SigningPublicKey = signingPublicKey,
            });

        // First claim wins the identity; every later call (first-claim retry
        // or reconnect refresh) must present the same identity, proven by
        // the same signing key, not merely a matching PublicKey — PublicKey
        // is public information anyone can read via Lookup().
        lock (entry)
        {
            if (entry.SigningPublicKey != signingPublicKey || entry.PublicKey != publicKey) return false;
            entry.ConnectionId = connectionId;
        }
        return true;
    }

    public UsernameRegistration? Lookup(string username) =>
        _byUsername.TryGetValue(Normalize(username), out var entry) ? entry : null;

    private static bool VerifyOwnership(string username, string connectionId, string signingPublicKeyBase64, string signatureBase64)
    {
        try
        {
            var publicKeyBytes = Convert.FromBase64String(signingPublicKeyBase64);
            var signatureBytes = Convert.FromBase64String(signatureBase64);
            var algorithm = SignatureAlgorithm.Ed25519;
            var publicKey = PublicKey.Import(algorithm, publicKeyBytes, KeyBlobFormat.RawPublicKey);
            var message = Encoding.UTF8.GetBytes($"{username}:{connectionId}");
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

    private static string Normalize(string username) => username.Trim().ToLowerInvariant();
}
