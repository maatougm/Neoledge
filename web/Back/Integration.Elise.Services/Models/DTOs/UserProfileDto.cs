/**
 * @file     UserProfileDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for user profile management
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>User profile information.</summary>
public record UserProfileDto(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string Role,
    string? AvatarPath,
    string? JobTitle,
    string? PhoneNumber,
    string? Department,
    DateTime CreatedAt,
    DateTime? LastLoginAt
);

/// <summary>Request to update user profile.</summary>
public record UpdateProfileDto(
    string? FirstName,
    string? LastName,
    string? JobTitle,
    string? PhoneNumber,
    string? Department
);

/// <summary>Request to upload avatar.</summary>
public record UploadAvatarDto(
    string Base64Image,
    string FileExtension
);

/// <summary>User preferences (stored as JSON).</summary>
public record UserPreferencesDto(
    bool EmailNotificationsEnabled,
    bool DarkMode,
    string? Language,
    string? TimeZone,
    Dictionary<string, object>? CustomSettings
);
