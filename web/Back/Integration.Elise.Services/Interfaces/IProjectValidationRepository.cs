/**
 * @file     IProjectValidationRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Repository contract for ProjectValidation persistence operations
 */

using Integration.Elise.Services.Models.Domain;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines persistence operations for <see cref="ProjectValidation"/> entities.
/// </summary>
public interface IProjectValidationRepository
{
    /// <summary>Returns all validations for a project, newest first, including the validator user.</summary>
    Task<IEnumerable<ProjectValidation>> GetByProjectIdAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Persists a new validation record and returns it.</summary>
    Task<ProjectValidation> AddAsync(ProjectValidation validation, CancellationToken ct = default);
}
