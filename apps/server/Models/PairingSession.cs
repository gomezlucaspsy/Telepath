namespace Telepath.Server.Models;

public class PairingSession
{
    public required string Code { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public string? LinkedPublicKey { get; set; }
    public bool IsCompleted => LinkedPublicKey is not null;
}

public record CreatePairingSessionResponse(string Code, DateTimeOffset ExpiresAt);

public record CompletePairingRequest(string PublicKey);
