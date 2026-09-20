namespace Telepath.Server.Models;

public class UsernameRegistration
{
    public required string Username { get; init; }
    public required string PublicKey { get; set; }
    public required string ConnectionId { get; set; }
    public required string SigningPublicKey { get; init; }
}

// SigningPublicKey/Signature prove the caller holds the private signing key
// for this identity — PublicKey and Username alone are not proof of
// ownership, since PublicKey is returned by the public lookup endpoint.
// Signature must cover "{Username}:{ConnectionId}" with SigningPublicKey.
public record RegisterUsernameRequest(
    string Username,
    string PublicKey,
    string ConnectionId,
    string SigningPublicKey,
    string Signature
);

public record UsernameLookupResponse(string PublicKey, string ConnectionId);
