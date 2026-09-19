using System.Collections.Concurrent;
using System.Security.Cryptography;
using Telepath.Server.Models;

namespace Telepath.Server.Services;

public interface IPairingStore
{
    PairingSession Create(string creatorPublicKey, string creatorConnectionId);
    PairingSession? Get(string code);
    bool Complete(string code, string peerPublicKey, string peerConnectionId);
}

// In-memory placeholder for scaffolding. Swap for a persistent store
// (Redis, etc.) before production — sessions must not survive a restart
// longer than their TTL for security reasons.
public class InMemoryPairingStore : IPairingStore
{
    private readonly ConcurrentDictionary<string, PairingSession> _sessions = new();

    public PairingSession Create(string creatorPublicKey, string creatorConnectionId)
    {
        // A six-digit code has only ~20 bits of entropy — an attacker can
        // brute-force it online within the 5-minute window with no rate
        // limiting in front of Complete(). Use a 128-bit opaque token
        // instead so online guessing is infeasible.
        var code = GenerateOpaqueToken();
        var session = new PairingSession
        {
            Code = code,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5),
            CreatorPublicKey = creatorPublicKey,
            CreatorConnectionId = creatorConnectionId,
        };
        _sessions[code] = session;
        return session;
    }

    public PairingSession? Get(string code)
    {
        if (!_sessions.TryGetValue(code, out var session)) return null;
        if (session.ExpiresAt < DateTimeOffset.UtcNow)
        {
            _sessions.TryRemove(code, out _);
            return null;
        }
        return session;
    }

    public bool Complete(string code, string peerPublicKey, string peerConnectionId)
    {
        var session = Get(code);
        if (session is null) return false;
        // Check-then-write on IsCompleted is only safe if serialized: two
        // concurrent requests can both observe IsCompleted == false and
        // both write, with the second silently overwriting the first
        // peer's key. Locking the session instance makes the
        // check-and-claim one atomic transition, so only the winner writes.
        lock (session)
        {
            if (session.IsCompleted) return false;
            session.PeerPublicKey = peerPublicKey;
            session.PeerConnectionId = peerConnectionId;
        }
        return true;
    }

    private static string GenerateOpaqueToken()
    {
        Span<byte> bytes = stackalloc byte[16];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }
}
