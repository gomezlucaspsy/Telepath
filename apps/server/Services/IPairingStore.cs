using System.Collections.Concurrent;
using Telepath.Server.Models;

namespace Telepath.Server.Services;

public interface IPairingStore
{
    PairingSession Create();
    PairingSession? Get(string code);
    bool Complete(string code, string publicKey);
}

// In-memory placeholder for scaffolding. Swap for a persistent store
// (Redis, etc.) before production — sessions must not survive a restart
// longer than their TTL for security reasons.
public class InMemoryPairingStore : IPairingStore
{
    private readonly ConcurrentDictionary<string, PairingSession> _sessions = new();

    public PairingSession Create()
    {
        var code = Random.Shared.Next(0, 999_999).ToString("D6");
        var session = new PairingSession
        {
            Code = code,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5)
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

    public bool Complete(string code, string publicKey)
    {
        var session = Get(code);
        if (session is null) return false;
        session.LinkedPublicKey = publicKey;
        return true;
    }
}
