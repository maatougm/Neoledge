/**
 * @file     ProjectActivity.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Activity feed entry for a project — records who did what and when
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>
/// Records a single auditable event on a project (creation, manager assignment, status change, etc.).
/// </summary>
public class ProjectActivity
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the project this activity belongs to.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>FK to the user who triggered the action. Null means a system-generated event.</summary>
    public Guid? UserId { get; set; }

    /// <summary>Short machine-readable action name, e.g. "ProjectCreated", "StatusChanged".</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Optional human-readable detail, e.g. "Draft → InProgress".</summary>
    public string? Detail { get; set; }

    /// <summary>UTC timestamp when the activity was recorded.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    /// <summary>The project this activity belongs to.</summary>
    public Project? Project { get; set; }

    /// <summary>The user who triggered this activity (null for system events).</summary>
    public AppUser? User { get; set; }
}
