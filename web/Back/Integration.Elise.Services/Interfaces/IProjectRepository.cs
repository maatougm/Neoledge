/**
 * @file     IProjectRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Repository contract for Project persistence operations
 */

using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines persistence operations for <see cref="Project"/> entities.
/// All methods accept a <see cref="CancellationToken"/> to support cooperative cancellation.
/// </summary>
public interface IProjectRepository
{
    /// <summary>Returns all projects (summary level — no field values).</summary>
    Task<IEnumerable<Project>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Returns a project including its manager, fields, and field values, or null.</summary>
    Task<Project?> GetByIdWithDetailsAsync(Guid id, CancellationToken ct = default);

    /// <summary>Returns all projects assigned to a specific project manager.</summary>
    Task<IEnumerable<Project>> GetByManagerIdAsync(Guid managerId, CancellationToken ct = default);

    /// <summary>Returns all projects with the given status.</summary>
    Task<IEnumerable<Project>> GetByStatusAsync(ProjectStatus status, CancellationToken ct = default);

    /// <summary>Persists a new project and seeds its static fields.</summary>
    Task<Project> CreateAsync(Project project, CancellationToken ct = default);

    /// <summary>Persists changes to an existing project.</summary>
    Task UpdateAsync(Project project, CancellationToken ct = default);

    /// <summary>Removes a project and all its child records.</summary>
    Task DeleteAsync(Guid id, CancellationToken ct = default);

    /// <summary>Assigns or replaces the project manager FK without loading the full graph.</summary>
    Task AssignManagerAsync(Guid projectId, Guid managerId, CancellationToken ct = default);

    /// <summary>Updates only the <see cref="Project.Status"/> column.</summary>
    Task UpdateStatusAsync(Guid projectId, ProjectStatus status, CancellationToken ct = default);

    /// <summary>Persists a new custom field record linked to the project.</summary>
    Task AddFieldAsync(ProjectField field, CancellationToken ct = default);

    /// <summary>Removes a field (and its values) from the project.</summary>
    Task RemoveFieldAsync(Guid fieldId, CancellationToken ct = default);

    /// <summary>Updates the <see cref="Project.AllowManagerCustomFields"/> flag.</summary>
    Task SetManagerFieldsPermissionAsync(Guid projectId, bool allow, CancellationToken ct = default);

    /// <summary>Bulk-upserts field values for a project questionnaire.</summary>
    Task SaveFieldValuesAsync(Guid projectId, IEnumerable<(Guid FieldId, string? Value)> values, CancellationToken ct = default);
}
