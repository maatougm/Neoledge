/**
 * @file     IProjectActivityRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Repository contract for ProjectActivity persistence operations
 */

using Integration.Elise.Services.Models.Domain;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines persistence operations for <see cref="ProjectActivity"/> entities.
/// </summary>
public interface IProjectActivityRepository
{
    /// <summary>
    /// Returns the most recent activities for a project, ordered newest-first.
    /// </summary>
    /// <param name="projectId">The project whose activities to return.</param>
    /// <param name="limit">Maximum number of rows to return (default 50).</param>
    /// <param name="ct">Cancellation token.</param>
    Task<IEnumerable<ProjectActivity>> GetByProjectIdAsync(Guid projectId, int limit = 50, CancellationToken ct = default);

    /// <summary>Persists a new activity record.</summary>
    Task AddAsync(ProjectActivity activity, CancellationToken ct = default);
}
