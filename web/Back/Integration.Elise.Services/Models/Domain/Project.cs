/**
 * @file     Project.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Project aggregate root entity with soft delete support
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.Domain;

/// <summary>A deployment project managed through the NeoLeadge platform.</summary>
public class Project
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Name of the project.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Name of the client / organisation.</summary>
    public string ClientName { get; set; } = string.Empty;

    /// <summary>UTC planned start date.</summary>
    public DateTime StartDate { get; set; }

    /// <summary>UTC planned end date — must be after <see cref="StartDate"/>.</summary>
    public DateTime EndDate { get; set; }

    /// <summary>FK to the assigned project manager (AppUser with role ProjectManager).</summary>
    public Guid? ProjectManagerId { get; set; }

    /// <summary>Current lifecycle status.</summary>
    public ProjectStatus Status { get; set; } = ProjectStatus.Draft;

    /// <summary>
    /// When <c>true</c>, the assigned project manager may add custom fields to the questionnaire.
    /// Toggled by an admin via PATCH /admin/project/{id}/toggle-manager-fields.
    /// </summary>
    public bool AllowManagerCustomFields { get; set; } = false;

    /// <summary>FK to the admin who created the project.</summary>
    public Guid CreatedByAdminId { get; set; }

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>UTC last-updated timestamp.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// AI-generated analysis or summary — filled in by an admin or automated pipeline.
    /// Displayed read-only to the project manager.
    /// </summary>
    public string? AiOutput { get; set; }

    // ── Soft Delete ─────────────────────────────────────────────────────────
    /// <summary>When true, the project is soft-deleted and hidden from normal queries.</summary>
    public bool IsDeleted { get; set; } = false;

    /// <summary>UTC timestamp when the project was soft-deleted. Null if not deleted.</summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>FK to user who deleted the project.</summary>
    public Guid? DeletedByUserId { get; set; }

    // ── Search/Filter Fields ────────────────────────────────────────────────
    /// <summary>Search tags for the project (comma-separated).</summary>
    public string? Tags { get; set; }

    /// <summary>Budget amount for the project (optional).</summary>
    public decimal? Budget { get; set; }

    /// <summary>Priority level of the project.</summary>
    public ProjectPriority Priority { get; set; } = ProjectPriority.Medium;

    // Navigation properties
    /// <summary>Assigned project manager.</summary>
    public AppUser? ProjectManager { get; set; }

    /// <summary>Admin who created this project.</summary>
    public AppUser? CreatedByAdmin { get; set; }

    /// <summary>User who deleted this project.</summary>
    public AppUser? DeletedByUser { get; set; }

    /// <summary>All field definitions attached to this project.</summary>
    public ICollection<ProjectField> Fields { get; set; } = new List<ProjectField>();

    /// <summary>All field values for this project.</summary>
    public ICollection<ProjectFieldValue> FieldValues { get; set; } = new List<ProjectFieldValue>();

    /// <summary>All comments on this project.</summary>
    public ICollection<ProjectComment> Comments { get; set; } = new List<ProjectComment>();

    /// <summary>All file attachments for this project.</summary>
    public ICollection<ProjectAttachment> Attachments { get; set; } = new List<ProjectAttachment>();
}
