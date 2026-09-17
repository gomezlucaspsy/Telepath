namespace Telepath.Server.Models;

public class PairingSession
{
    public required string Code { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required string CreatorPublicKey { get; init; }
    public required string CreatorConnectionId { get; init; }
    public string? PeerPublicKey { get; set; }
    public string? PeerConnectionId { get; set; }
    public bool IsCompleted => PeerPublicKey is not null;
}

public record CreatePairingSessionRequest(string PublicKey, string ConnectionId);

public record CreatePairingSessionResponse(string Code, DateTimeOffset ExpiresAt);

public record PairingSessionStatusResponse(
    bool IsCompleted,
    string CreatorPublicKey,
    string CreatorConnectionId,
    string? PeerPublicKey,
    string? PeerConnectionId
);

public record CompletePairingRequest(string PublicKey, string ConnectionId);
