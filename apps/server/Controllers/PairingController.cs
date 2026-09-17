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
    public ActionResult<CreatePairingSessionResponse> CreateSession()
    {
        var session = store.Create();
        return Ok(new CreatePairingSessionResponse(session.Code, session.ExpiresAt));
    }

    // Polled by the QR-displaying client to know when pairing finished.
    [HttpGet("session/{code}")]
    public ActionResult<object> GetSession(string code)
    {
        var session = store.Get(code);
        if (session is null) return NotFound();
        return Ok(new { session.IsCompleted });
    }

    // Called by the client that scans the QR code, submitting its public key.
    [HttpPost("session/{code}/complete")]
    public IActionResult CompleteSession(string code, [FromBody] CompletePairingRequest request)
    {
        var ok = store.Complete(code, request.PublicKey);
        return ok ? NoContent() : NotFound();
    }
}
