/**
 * @file     IProjectTemplateRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Repository contract for ProjectTemplate persistence operations
 */

using Integration.Elise.Services.Models.Domain;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines persistence operations for <see cref="ProjectTemplate"/> entities.
/// </summary>
public interface IProjectTemplateRepository
{
    /// <summary>Returns all templates (fields are NOT included — use for list views).</summary>
    Task<IEnumerable<ProjectTemplate>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Returns a single template with its fields included, or null if not found.</summary>
    Task<ProjectTemplate?> GetByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>Persists a new template (including its child fields).</summary>
    Task<ProjectTemplate> AddAsync(ProjectTemplate template, CancellationToken ct = default);

    /// <summary>Removes a template and all its child fields.</summary>
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
