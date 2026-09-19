using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Telepath.Server.Models;
using Telepath.Server.Services;

namespace Telepath.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public partial class UsersController(IUsernameDirectory directory) : ControllerBase
{
    [GeneratedRegex("^[a-zA-Z0-9_]{3,20}$")]
    private static partial Regex UsernamePattern();

    // Called on first claiming a username, and again after every SignalR
    // reconnect to keep the directory's connectionId fresh — otherwise a
    // contact added by username would go stale exactly like a raw
    // connectionId does.
    [HttpPost("register")]
    public IActionResult Register([FromBody] RegisterUsernameRequest request)
    {
        if (!UsernamePattern().IsMatch(request.Username))
        {
            return BadRequest("Username inválido: 3-20 caracteres, letras/números/guión bajo.");
        }

        var ok = directory.Register(request.Username, request.PublicKey, request.ConnectionId);
        return ok ? NoContent() : Conflict("Ese username ya está en uso.");
    }

    // Called by whoever wants to add this username as a contact.
    [HttpGet("{username}")]
    public ActionResult<UsernameLookupResponse> Lookup(string username)
    {
        var entry = directory.Lookup(username);
        if (entry is null) return NotFound();
        return Ok(new UsernameLookupResponse(entry.PublicKey, entry.ConnectionId));
    }
}
