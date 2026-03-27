/**
 * @file     IAppUserRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Repository contract for AppUser persistence operations
 */

using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines persistence operations for <see cref="AppUser"/> entities.
/// All methods accept a <see cref="CancellationToken"/> to support cooperative cancellation.
/// </summary>
public interface IAppUserRepository
{
    /// <summary>Returns all users ordered by last name, first name.</summary>
    Task<IEnumerable<AppUser>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Returns a single user by primary key, or null if not found.</summary>
    Task<AppUser?> GetByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>Returns a single user by email address (case-insensitive), or null if not found.</summary>
    Task<AppUser?> GetByEmailAsync(string email, CancellationToken ct = default);

    /// <summary>Returns all users that have the specified role.</summary>
    Task<IEnumerable<AppUser>> GetByRoleAsync(UserRole role, CancellationToken ct = default);

    /// <summary>Returns true if an active account already exists with the given email.</summary>
    Task<bool> ExistsAsync(string email, CancellationToken ct = default);

    /// <summary>Persists a new user to the database.</summary>
    Task<AppUser> CreateAsync(AppUser user, CancellationToken ct = default);

    /// <summary>Persists changes to an existing user.</summary>
    Task UpdateAsync(AppUser user, CancellationToken ct = default);

    /// <summary>Soft-deletes a user by setting <see cref="AppUser.IsActive"/> to false.</summary>
    Task SoftDeleteAsync(Guid id, CancellationToken ct = default);
}
