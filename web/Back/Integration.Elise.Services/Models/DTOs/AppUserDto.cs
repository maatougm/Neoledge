/**
 * @file     AppUserDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     DTOs and AutoMapper profile for AppUser CRUD operations
 */

using AutoMapper;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.DTOs;

// ─── Request DTOs ────────────────────────────────────────────────────────────

/// <summary>Payload for creating a new user.</summary>
public record CreateUserDto(
    string FirstName,
    string LastName,
    string Email,
    string Password,
    UserRole Role
);

/// <summary>Payload for updating an existing user. All fields are optional.</summary>
public record UpdateUserDto(
    string? FirstName,
    string? LastName,
    string? Email,
    UserRole? Role
);

/// <summary>Payload for changing a user's own password.</summary>
public record ChangePasswordDto(
    string CurrentPassword,
    string NewPassword
);

// ─── Response DTOs ───────────────────────────────────────────────────────────

/// <summary>Full user representation returned to the client.</summary>
public record UserResponseDto(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    UserRole Role,
    bool IsActive,
    bool MustChangePassword,
    DateTime CreatedAt,
    DateTime? LastLoginAt
);

// ─── AutoMapper profile ──────────────────────────────────────────────────────

/// <summary>Maps between <see cref="AppUser"/> and its DTOs.</summary>
public class AppUserMappingProfile : Profile
{
    public AppUserMappingProfile()
    {
        CreateMap<AppUser, UserResponseDto>();
    }
}
