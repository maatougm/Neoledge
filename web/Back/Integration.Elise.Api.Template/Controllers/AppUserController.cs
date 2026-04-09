/**
 * @file     AppUserController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     REST endpoints for user management (Admin only)
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages application users.
/// All endpoints require a valid JWT and the <c>Admin</c> role.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("admin/[controller]")]
public class AppUserController : ControllerBase
{
    private readonly IAppUserService _userService;
    private readonly Serilog.ILogger _logger;

    public AppUserController(IAppUserService userService, Serilog.ILogger logger)
    {
        _userService = userService;
        _logger      = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? Guid.Empty.ToString());

    /// <summary>
    /// Returns users with optional search, role filter, and pagination.
    /// When no query parameters are provided the response is backward-compatible
    /// (returns all users wrapped in a paginated envelope).
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(PaginatedResult<UserResponseDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAll(
        [FromQuery] int skip = 0,
        [FromQuery] int take = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? role = null,
        CancellationToken ct = default)
    {
        var result = await _userService.GetUsersPagedAsync(skip, take, search, role, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Returns a single user by id.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await _userService.GetUserByIdAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(result.Error);
    }

    /// <summary>Returns all users with the specified role.</summary>
    [HttpGet("by-role/{role}")]
    [ProducesResponseType(typeof(IEnumerable<UserResponseDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetByRole(UserRole role, CancellationToken ct)
    {
        var result = await _userService.GetUsersByRoleAsync(role, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Creates a new user.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateUserDto dto, CancellationToken ct)
    {
        var result = await _userService.CreateUserAsync(dto, ct);
        if (result.IsFailure)
        {
            _logger.Warning("CreateUser failed: {Error}", result.Error);
            return BadRequest(result.Error);
        }
        return CreatedAtAction(nameof(GetById), new { id = result.Value!.Id }, result.Value);
    }

    /// <summary>Updates mutable fields of an existing user.</summary>
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(UserResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserDto dto, CancellationToken ct)
    {
        var result = await _userService.UpdateUserAsync(id, dto, ct);
        return result.IsSuccess ? Ok(result.Value) : result.Error!.Contains("introuvable")
            ? NotFound(result.Error) : BadRequest(result.Error);
    }

    /// <summary>Resets a user's password and returns the temporary plaintext value.</summary>
    [HttpPost("{id:guid}/reset-password")]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ResetPassword(Guid id, CancellationToken ct)
    {
        var result = await _userService.ResetPasswordAsync(id, ct);
        return result.IsSuccess
            ? Ok(new { temporaryPassword = result.Value })
            : NotFound(result.Error);
    }

    /// <summary>Deactivates (soft-deletes) a user account.</summary>
    [HttpPost("{id:guid}/deactivate")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Deactivate(Guid id, CancellationToken ct)
    {
        var result = await _userService.DeactivateAsync(id, CurrentUserId, ct);
        return result.IsSuccess ? NoContent() : BadRequest(result.Error);
    }

    /// <summary>Reactivates a previously deactivated user.</summary>
    [HttpPost("{id:guid}/reactivate")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct)
    {
        var result = await _userService.ReactivateAsync(id, ct);
        return result.IsSuccess ? NoContent() : NotFound(result.Error);
    }
}
