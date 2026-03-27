/**
 * @file     IUserProfileService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for user profile management
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using ChangePasswordDto = Integration.Elise.Services.Models.DTOs.ChangePasswordDto;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Manages user profile operations.
/// </summary>
public interface IUserProfileService
{
    /// <summary>Gets the user profile.</summary>
    Task<Result<UserProfileDto>> GetProfileAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Updates the user profile.</summary>
    Task<Result<UserProfileDto>> UpdateProfileAsync(Guid userId, UpdateProfileDto dto, CancellationToken ct = default);

    /// <summary>Changes the user's password.</summary>
    Task<Result> ChangePasswordAsync(Guid userId, ChangePasswordDto dto, CancellationToken ct = default);

    /// <summary>Uploads a new avatar image.</summary>
    Task<Result<string>> UploadAvatarAsync(Guid userId, UploadAvatarDto dto, CancellationToken ct = default);

    /// <summary>Gets user preferences.</summary>
    Task<Result<UserPreferencesDto>> GetPreferencesAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Updates user preferences.</summary>
    Task<Result> UpdatePreferencesAsync(Guid userId, UserPreferencesDto dto, CancellationToken ct = default);
}
