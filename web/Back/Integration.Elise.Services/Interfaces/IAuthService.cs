/**
 * @file     IAuthService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Contract for credential validation — JWT generation is the API layer's responsibility
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Validates user credentials against the database.
/// Returns the matching user DTO on success so the API layer can embed claims into the JWT.
/// </summary>
public interface IAuthService
{
    /// <summary>
    /// Checks <paramref name="email"/> exists, is active, and <paramref name="password"/>
    /// matches the stored BCrypt hash.
    /// </summary>
    Task<Result<UserResponseDto>> ValidateCredentialsAsync(
        string email,
        string password,
        CancellationToken ct = default);
}
