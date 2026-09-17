using Microsoft.AspNetCore.Mvc;
using Telepath.Server.Models;
using Telepath.Server.Services;

namespace Telepath.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PairingController(IPairingStore store) : ControllerBase
{
    // Called by the client that shows the QR code (e.g. the web PWA).
    [HttpPost("session")]
    public ActionResult<CreatePairingSessionResponse> CreateSession([FromBody] CreatePairingSessionRequest request)
    {
        var session = store.Create(request.PublicKey, request.ConnectionId);
        return Ok(new CreatePairingSessionResponse(session.Code, session.ExpiresAt));
    }

    // Polled by the QR-displaying client to know when pairing finished, and
    // used by the scanning client to learn the creator's public key/connection.
    [HttpGet("session/{code}")]
    public ActionResult<PairingSessionStatusResponse> GetSession(string code)
    {
        var session = store.Get(code);
        if (session is null) return NotFound();
        return Ok(new PairingSessionStatusResponse(
            session.IsCompleted,
            session.CreatorPublicKey,
            session.CreatorConnectionId,
            session.PeerPublicKey,
            session.PeerConnectionId
        ));
    }

    // Called by the client that scans the QR code, submitting its own public key.
    [HttpPost("session/{code}/complete")]
    public IActionResult CompleteSession(string code, [FromBody] CompletePairingRequest request)
    {
        var ok = store.Complete(code, request.PublicKey, request.ConnectionId);
        return ok ? NoContent() : NotFound();
    }
}
