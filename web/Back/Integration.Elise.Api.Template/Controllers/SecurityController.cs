/**
 * @file     SecurityController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Admin-only security monitoring endpoints — failed login log, lockout status
 */

using Integration.Elise.Api.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Template.Controllers;

[ApiController]
[Route("admin/[controller]")]
[Authorize]
public class SecurityController : ControllerBase
{
    /// <summary>
    /// Returns the current in-memory failed login log from <see cref="AuthController"/>.
    /// Each entry contains the email address, consecutive attempt count, and optional lock-expiry timestamp.
    /// </summary>
    [HttpGet("failed-logins")]
    public IActionResult GetFailedLogins()
    {
        return Ok(AuthController.GetFailedLoginLog());
    }
}
