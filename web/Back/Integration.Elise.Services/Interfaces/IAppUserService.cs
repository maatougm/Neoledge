/**
 * @file     IAppUserService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Service contract for user management business operations
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines business-level operations for managing <c>AppUser</c> entities.
/// All methods return <see cref="Result{T}"/> to avoid throwing for expected failures.
/// </summary>
public interface IAppUserService
{
    /// <summary>Returns all users.</summary>
    Task<Result<IEnumerable<UserResponseDto>>> GetAllUsersAsync(CancellationToken ct = default);

    /// <summary>Returns a single user by id.</summary>
    Task<Result<UserResponseDto>> GetUserByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>Returns all users that have the specified role.</summary>
    Task<Result<IEnumerable<UserResponseDto>>> GetUsersByRoleAsync(UserRole role, CancellationToken ct = default);

    /// <summary>Creates a new user after hashing the password and verifying email uniqueness.</summary>
    Task<Result<UserResponseDto>> CreateUserAsync(CreateUserDto dto, CancellationToken ct = default);

    /// <summary>Updates an existing user's mutable fields (partial update — null fields are ignored).</summary>
    Task<Result<UserResponseDto>> UpdateUserAsync(Guid id, UpdateUserDto dto, CancellationToken ct = default);

    /// <summary>Generates a temporary plaintext password, hashes and stores it, then returns the plaintext value.</summary>
    Task<Result<string>> ResetPasswordAsync(Guid id, CancellationToken ct = default);

    /// <summary>Deactivates a user (soft-delete). Cannot deactivate one's own account.</summary>
    Task<Result> DeactivateAsync(Guid id, Guid requestingUserId, CancellationToken ct = default);

    /// <summary>Reactivates a previously deactivated user.</summary>
    Task<Result> ReactivateAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Returns a paginated, optionally filtered list of users.
    /// Filters by first name, last name, or email search and role enum.
    /// </summary>
    Task<Result<PaginatedResult<UserResponseDto>>> GetUsersPagedAsync(
        int skip, int take, string? search, string? role, CancellationToken ct = default);
}
