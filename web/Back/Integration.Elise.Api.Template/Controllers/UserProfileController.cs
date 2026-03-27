/**
 * @file     UserProfileController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for user profile management
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using ChangePasswordDto = Integration.Elise.Services.Models.DTOs.ChangePasswordDto;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages user profile and preferences.
/// </summary>
[ApiController]
[Authorize]
[Route("api/[controller]")]
public class UserProfileController : ControllerBase
{
    private readonly IUserProfileService _profileService;
    private readonly Serilog.ILogger _logger;

    public UserProfileController(IUserProfileService profileService, Serilog.ILogger logger)
    {
        _profileService = profileService;
        _logger = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    /// <summary>Gets the current user's profile.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(UserProfileDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProfile(CancellationToken ct)
    {
        var result = await _profileService.GetProfileAsync(CurrentUserId, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Updates the current user's profile.</summary>
    [HttpPut]
    [ProducesResponseType(typeof(UserProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileDto dto, CancellationToken ct)
    {
        var result = await _profileService.UpdateProfileAsync(CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return Ok(result.Value);
    }

    /// <summary>Changes the current user's password.</summary>
    [HttpPost("change-password")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDto dto, CancellationToken ct)
    {
        var result = await _profileService.ChangePasswordAsync(CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return NoContent();
    }

    /// <summary>Uploads a new avatar image.</summary>
    [HttpPost("avatar")]
    [ProducesResponseType(typeof(string), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UploadAvatar([FromBody] UploadAvatarDto dto, CancellationToken ct)
    {
        var result = await _profileService.UploadAvatarAsync(CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return Ok(new { avatarPath = result.Value });
    }

    /// <summary>Gets the current user's preferences.</summary>
    [HttpGet("preferences")]
    [ProducesResponseType(typeof(UserPreferencesDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPreferences(CancellationToken ct)
    {
        var result = await _profileService.GetPreferencesAsync(CurrentUserId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Updates the current user's preferences.</summary>
    [HttpPut("preferences")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdatePreferences([FromBody] UserPreferencesDto dto, CancellationToken ct)
    {
        var result = await _profileService.UpdatePreferencesAsync(CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return NoContent();
    }
}
