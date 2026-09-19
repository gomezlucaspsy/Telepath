namespace Telepath.Server.Models;

public class UsernameRegistration
{
    public required string Username { get; init; }
    public required string PublicKey { get; set; }
    public required string ConnectionId { get; set; }
}

public record RegisterUsernameRequest(string Username, string PublicKey, string ConnectionId);

public record UsernameLookupResponse(string PublicKey, string ConnectionId);
