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
        // A predictable PRNG here would let an attacker bias/guess pairing
        // codes and race a legitimate peer to complete the key exchange
        // (see Complete() below) — this code gates the one moment two
        // identity keys get introduced, so it needs a CSPRNG, not Random.Shared.
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
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
        // First writer wins. Without this check, a second caller (an
        // attacker who observed or guessed the code) could silently
        // overwrite an already-completed session's peer key and hijack
        // the key exchange — the creator would establish a ratchet
        // session with the attacker's identity key instead of the real
        // peer's, with no error on either side.
        if (session is null || session.IsCompleted) return false;
        session.PeerPublicKey = peerPublicKey;
        session.PeerConnectionId = peerConnectionId;
        return true;
    }
}
