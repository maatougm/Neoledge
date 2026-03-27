/**
 * @file     UserProfileService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     User profile management service
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using ChangePasswordDto = Integration.Elise.Services.Models.DTOs.ChangePasswordDto;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Integration.Elise.Services.Services;

/// <inheritdoc />
public class UserProfileService : IUserProfileService
{
    private readonly ApplicationDbContext _db;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<UserProfileService> _logger;

    public UserProfileService(ApplicationDbContext db, IWebHostEnvironment env, ILogger<UserProfileService> logger)
    {
        _db = db;
        _env = env;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result<UserProfileDto>> GetProfileAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.AppUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user == null)
            return Result<UserProfileDto>.Fail("User not found");

        var dto = new UserProfileDto(
            Id: user.Id,
            FirstName: user.FirstName,
            LastName: user.LastName,
            Email: user.Email,
            Role: user.Role.ToString(),
            AvatarPath: user.AvatarPath,
            JobTitle: user.JobTitle,
            PhoneNumber: user.PhoneNumber,
            Department: user.Department,
            CreatedAt: user.CreatedAt,
            LastLoginAt: user.LastLoginAt
        );

        return Result<UserProfileDto>.Ok(dto);
    }

    /// <inheritdoc />
    public async Task<Result<UserProfileDto>> UpdateProfileAsync(Guid userId, UpdateProfileDto dto, CancellationToken ct = default)
    {
        var user = await _db.AppUsers.FindAsync(new object[] { userId }, ct);
        if (user == null)
            return Result<UserProfileDto>.Fail("User not found");

        if (!string.IsNullOrEmpty(dto.FirstName))
            user.FirstName = dto.FirstName;

        if (!string.IsNullOrEmpty(dto.LastName))
            user.LastName = dto.LastName;

        if (dto.JobTitle != null)
            user.JobTitle = dto.JobTitle;

        if (dto.PhoneNumber != null)
            user.PhoneNumber = dto.PhoneNumber;

        if (dto.Department != null)
            user.Department = dto.Department;

        await _db.SaveChangesAsync(ct);

        return await GetProfileAsync(userId, ct);
    }

    /// <inheritdoc />
    public async Task<Result> ChangePasswordAsync(Guid userId, ChangePasswordDto dto, CancellationToken ct = default)
    {
        var user = await _db.AppUsers.FindAsync(new object[] { userId }, ct);
        if (user == null)
            return Result.Fail("User not found");

        // Verify current password — skip check when user is forced to change on first login
        if (!user.MustChangePassword &&
            !BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, user.PasswordHash))
            return Result.Fail("Current password is incorrect");

        // Validate new password — must match frontend rule: ≥8 chars, 1 uppercase, 1 digit
        if (string.IsNullOrEmpty(dto.NewPassword) || dto.NewPassword.Length < 8)
            return Result.Fail("Le mot de passe doit comporter au moins 8 caractères.");

        if (!dto.NewPassword.Any(char.IsUpper))
            return Result.Fail("Le mot de passe doit contenir au moins une lettre majuscule.");

        if (!dto.NewPassword.Any(char.IsDigit))
            return Result.Fail("Le mot de passe doit contenir au moins un chiffre.");

        // Hash and save new password
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
        user.MustChangePassword = false;

        await _db.SaveChangesAsync(ct);

        return Result.Ok();
    }

    /// <inheritdoc />
    public async Task<Result<string>> UploadAvatarAsync(Guid userId, UploadAvatarDto dto, CancellationToken ct = default)
    {
        var user = await _db.AppUsers.FindAsync(new object[] { userId }, ct);
        if (user == null)
            return Result<string>.Fail("User not found");

        try
        {
            // Validate and convert base64
            byte[] imageBytes;
            try
            {
                imageBytes = Convert.FromBase64String(dto.Base64Image);
            }
            catch
            {
                return Result<string>.Fail("Invalid base64 image data");
            }

            // Validate file size (max 2MB)
            if (imageBytes.Length > 2 * 1024 * 1024)
                return Result<string>.Fail("Image size must be less than 2MB");

            // Create uploads directory
            var uploadsDir = Path.Combine(_env.WebRootPath ?? _env.ContentRootPath, "uploads", "avatars");
            Directory.CreateDirectory(uploadsDir);

            // Generate unique filename
            var fileName = $"{userId}_{DateTime.UtcNow:yyyyMMddHHmmss}{dto.FileExtension}";
            var filePath = Path.Combine(uploadsDir, fileName);

            // Save file
            await File.WriteAllBytesAsync(filePath, imageBytes, ct);

            // Update user avatar path
            var relativePath = $"/uploads/avatars/{fileName}";
            user.AvatarPath = relativePath;
            await _db.SaveChangesAsync(ct);

            return Result<string>.Ok(relativePath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upload avatar for user {UserId}", userId);
            return Result<string>.Fail("Failed to upload avatar");
        }
    }

    /// <inheritdoc />
    public async Task<Result<UserPreferencesDto>> GetPreferencesAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.AppUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user == null)
            return Result<UserPreferencesDto>.Fail("User not found");

        UserPreferencesDto preferences;
        if (!string.IsNullOrEmpty(user.Preferences))
        {
            try
            {
                preferences = System.Text.Json.JsonSerializer.Deserialize<UserPreferencesDto>(user.Preferences)
                    ?? GetDefaultPreferences();
            }
            catch
            {
                preferences = GetDefaultPreferences();
            }
        }
        else
        {
            preferences = GetDefaultPreferences();
        }

        return Result<UserPreferencesDto>.Ok(preferences);
    }

    /// <inheritdoc />
    public async Task<Result> UpdatePreferencesAsync(Guid userId, UserPreferencesDto dto, CancellationToken ct = default)
    {
        var user = await _db.AppUsers.FindAsync(new object[] { userId }, ct);
        if (user == null)
            return Result.Fail("User not found");

        user.Preferences = System.Text.Json.JsonSerializer.Serialize(dto);
        await _db.SaveChangesAsync(ct);

        return Result.Ok();
    }

    private static UserPreferencesDto GetDefaultPreferences()
    {
        return new UserPreferencesDto(
            EmailNotificationsEnabled: true,
            DarkMode: false,
            Language: "fr",
            TimeZone: "Europe/Paris",
            CustomSettings: new Dictionary<string, object>()
        );
    }
}

