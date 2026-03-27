/**
 * @file     AuthController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Public authentication endpoint — hardcoded bypass until real auth is wired up
 *
 * TODO: Replace HardcodedLogin with ValidateCredentialsAsync once SQL Server is available.
 */

using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using ChangePasswordDto = Integration.Elise.Services.Models.DTOs.ChangePasswordDto;

namespace Integration.Elise.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("[controller]")]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly IUserProfileService _profileService;
    private readonly IAuthService _authService;

    // Hardcoded test users — keyed by email (lowercase)
    // MustChangePassword = true is set on the 4th test user to simulate a first-login forced change
    private static readonly Dictionary<string, (string Password, string Role, string FirstName, string LastName, bool MustChangePassword)> TestUsers = new()
    {
        ["admin@neoleadge.com"]   = ("Admin@123",  "Admin",          "Admin",  "NeoLeadge",   false),
        ["pm@neoleadge.com"]      = ("Pm@123",     "ProjectManager", "Chef",   "DeProjet",    false),
        ["pm2@neoleadge.com"]     = ("Pm2@123",    "ProjectManager", "Marie",  "Dupont",      false),
        ["valid@neoleadge.com"]   = ("Valid@123",  "DeploymentTeam", "Equipe", "Validation",  false),
        ["newuser@neoleadge.com"] = ("Temp@123",   "Viewer",         "Nouvel", "Utilisateur", true),
    };

    // TODO: Replace with DB-backed tracking when auth is wired to DB
    // In-memory store of failed login attempts per email: (Attempts, LockedUntil)
    private static readonly ConcurrentDictionary<string, (int Attempts, DateTime? LockedUntil)> _failedLoginTracker = new();

    public AuthController(IConfiguration config, IUserProfileService profileService, IAuthService authService)
    {
        _config         = config;
        _profileService = profileService;
        _authService    = authService;
    }

    /// <summary>
    /// Authenticates a user against the database (BCrypt). Falls back to in-memory test
    /// users when the database is unavailable (local dev without SQL Server).
    /// Enforces account lockout after 5 consecutive failed attempts (15-minute window).
    /// </summary>
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto dto, CancellationToken ct)
    {
        var email = dto.Email.Trim().ToLowerInvariant();

        // Check in-memory lockout (applies to both DB and fallback paths)
        if (_failedLoginTracker.TryGetValue(email, out var tracker) && tracker.LockedUntil.HasValue)
        {
            if (tracker.LockedUntil.Value > DateTime.UtcNow)
            {
                var lockedUntilLocal = tracker.LockedUntil.Value.ToLocalTime();
                return Unauthorized(new { error = $"Compte verrouillé jusqu'à {lockedUntilLocal:HH:mm}." });
            }
            _failedLoginTracker.TryRemove(email, out _);
        }

        // ── Primary path: validate against DB ─────────────────────────────────
        try
        {
            var dbResult = await _authService.ValidateCredentialsAsync(email, dto.Password, ct);
            if (dbResult.IsSuccess)
            {
                _failedLoginTracker.TryRemove(email, out _);
                var u     = dbResult.Value!;
                var token = GenerateJwt(u.Id, u.Email, u.Role.ToString(), u.FirstName, u.LastName);
                return Ok(new { jwt = token, mustChangePassword = u.MustChangePassword });
            }
        }
        catch
        {
            // DB unavailable — fall through to hardcoded test users
        }

        // ── Fallback: hardcoded test users (dev only) ─────────────────────────
        if (!TestUsers.TryGetValue(email, out var fallbackUser) || fallbackUser.Password != dto.Password)
        {
            _failedLoginTracker.AddOrUpdate(
                email,
                addValue: (1, null),
                updateValueFactory: (_, existing) =>
                {
                    var newAttempts = existing.Attempts + 1;
                    var locked      = newAttempts >= 5 ? DateTime.UtcNow.AddMinutes(15) : (DateTime?)null;
                    return (newAttempts, locked);
                });

            return Unauthorized(new { error = "Email ou mot de passe incorrect." });
        }

        _failedLoginTracker.TryRemove(email, out _);
        var fallbackToken = GenerateJwt(Guid.NewGuid(), email, fallbackUser.Role,
                                        fallbackUser.FirstName, fallbackUser.LastName);
        return Ok(new { jwt = fallbackToken, mustChangePassword = fallbackUser.MustChangePassword });
    }

    /// <summary>
    /// Changes the authenticated user's password.
    /// </summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePasswordAsync([FromBody] ChangePasswordDto dto, CancellationToken ct)
    {
        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
               ?? User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(sub, out var userId))
            return Unauthorized();

        var result = await _profileService.ChangePasswordAsync(userId, dto, ct);
        return result.IsSuccess
            ? Ok(new { message = "Mot de passe modifié avec succès." })
            : BadRequest(new { error = result.Error });
    }

    /// <summary>
    /// Returns the current state of the in-memory failed login tracker.
    /// Consumed by <see cref="SecurityController"/>.
    /// </summary>
    public static IReadOnlyList<object> GetFailedLoginLog()
    {
        return _failedLoginTracker
            .Select(kvp => (object)new
            {
                email       = kvp.Key,
                attempts    = kvp.Value.Attempts,
                lockedUntil = kvp.Value.LockedUntil
            })
            .ToList();
    }

    // ── private helpers ────────────────────────────────────────────────────────

    private string GenerateJwt(Guid id, string email, string role, string firstName, string lastName)
    {
        var jwtSection  = _config.GetSection("CustomAction:Jwt");
        var key         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSection["Key"]!));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expires     = DateTime.UtcNow.AddHours(double.Parse(jwtSection["Expires"] ?? "5"));

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub,   id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim(ClaimTypes.Role,               role),
            new Claim("firstName",                   firstName),
            new Claim("lastName",                    lastName),
        };

        var token = new JwtSecurityToken(
            issuer:             jwtSection["Issuer"],
            audience:           jwtSection["Audience"],
            claims:             claims,
            expires:            expires,
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
