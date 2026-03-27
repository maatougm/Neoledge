/**
 * @file     IProjectService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Service contract for project management business operations
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines business-level operations for managing <c>Project</c> entities.
/// </summary>
public interface IProjectService
{
    /// <summary>Returns all projects (summary level).</summary>
    Task<Result<IEnumerable<ProjectSummaryDto>>> GetAllProjectsAsync(CancellationToken ct = default);

    /// <summary>Returns a full project including manager, fields and field values.</summary>
    Task<Result<ProjectDetailDto>> GetProjectByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>Returns projects assigned to the given project manager.</summary>
    Task<Result<IEnumerable<ProjectSummaryDto>>> GetMyProjectsAsync(Guid managerId, CancellationToken ct = default);

    /// <summary>Returns projects filtered by lifecycle status.</summary>
    Task<Result<IEnumerable<ProjectSummaryDto>>> GetProjectsByStatusAsync(ProjectStatus status, CancellationToken ct = default);

    /// <summary>
    /// Creates a project, validates dates and the PM role, and auto-seeds static field definitions.
    /// </summary>
    Task<Result<ProjectDetailDto>> CreateProjectAsync(Guid adminId, CreateProjectDto dto, CancellationToken ct = default);

    /// <summary>Updates mutable project metadata fields.</summary>
    Task<Result<ProjectDetailDto>> UpdateProjectAsync(Guid id, UpdateProjectDto dto, CancellationToken ct = default);

    /// <summary>Deletes a project and all associated records (hard delete).</summary>
    Task<Result> DeleteProjectAsync(Guid id, CancellationToken ct = default);

    /// <summary>Assigns a new project manager, unassigning the previous one.</summary>
    Task<Result> AssignProjectManagerAsync(Guid projectId, Guid managerId, CancellationToken ct = default);

    /// <summary>Advances or sets the project lifecycle status.</summary>
    Task<Result> UpdateProjectStatusAsync(Guid projectId, ProjectStatus status, CancellationToken ct = default);

    /// <summary>Archives a project — sets its status to <see cref="ProjectStatus.Archived"/>.</summary>
    Task<Result> ArchiveProjectAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Adds a custom field to the project questionnaire (FieldCategory.Custom).</summary>
    Task<Result<ProjectFieldDto>> AddCustomFieldAsync(Guid projectId, AddProjectFieldDto dto, CancellationToken ct = default);

    /// <summary>Removes a custom field from the project questionnaire.</summary>
    Task<Result> RemoveFieldAsync(Guid projectId, Guid fieldId, CancellationToken ct = default);

    /// <summary>Grants or revokes the project manager's permission to add custom fields.</summary>
    Task<Result> ToggleManagerFieldsAsync(Guid projectId, bool allow, CancellationToken ct = default);

    /// <summary>
    /// Creates a copy of an existing project with a new name.
    /// The duplicate starts in <see cref="ProjectStatus.Draft"/>, has no assigned manager,
    /// and retains only Static field values from the source.
    /// </summary>
    Task<Result<ProjectDetailDto>> DuplicateProjectAsync(Guid projectId, string newName, CancellationToken ct = default);

    /// <summary>Archives multiple projects in one operation.</summary>
    Task<Result> BulkArchiveAsync(IEnumerable<Guid> projectIds, CancellationToken ct = default);

    /// <summary>
    /// Transitions multiple projects to the requested status, enforcing phase gates.
    /// Projects that fail the gate are skipped; the result reports any skipped items.
    /// </summary>
    Task<Result> BulkUpdateStatusAsync(IEnumerable<Guid> projectIds, ProjectStatus status, CancellationToken ct = default);

    /// <summary>Assigns a project manager to multiple projects in one operation.</summary>
    Task<Result> BulkAssignManagerAsync(IEnumerable<Guid> projectIds, Guid managerId, CancellationToken ct = default);

    /// <summary>Returns the activity feed for a project, newest first.</summary>
    Task<Result<IEnumerable<ProjectActivityDto>>> GetActivityAsync(Guid projectId, CancellationToken ct = default);

    // ── New Features ───────────────────────────────────────────────────────

    /// <summary>Soft-deletes a project (can be restored later).</summary>
    Task<Result> SoftDeleteProjectAsync(Guid projectId, Guid deletedByUserId, CancellationToken ct = default);

    /// <summary>Restores a soft-deleted project.</summary>
    Task<Result> RestoreProjectAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Gets soft-deleted projects (for admin trash view).</summary>
    Task<Result<IEnumerable<ProjectSummaryDto>>> GetDeletedProjectsAsync(CancellationToken ct = default);

    /// <summary>Searches and filters projects with pagination.</summary>
    Task<Result<PagedResultDto<ProjectSummaryDto>>> SearchProjectsAsync(ProjectSearchFilterDto filter, CancellationToken ct = default);

    /// <summary>Gets projects by priority level.</summary>
    Task<Result<IEnumerable<ProjectSummaryDto>>> GetProjectsByPriorityAsync(ProjectPriority priority, CancellationToken ct = default);

    /// <summary>Updates project priority.</summary>
    Task<Result> UpdateProjectPriorityAsync(Guid projectId, ProjectPriority priority, CancellationToken ct = default);

    /// <summary>Updates project tags.</summary>
    Task<Result> UpdateProjectTagsAsync(Guid projectId, string tags, CancellationToken ct = default);
}
