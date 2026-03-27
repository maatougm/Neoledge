/**
 * @file     ProjectTemplate.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Reusable project template — defines a set of custom fields an admin can apply to any project
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>
/// A reusable template that an admin can define and later apply to any project,
/// which copies its Custom fields into that project's questionnaire.
/// </summary>
public class ProjectTemplate
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Display name for the template.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Optional description of what the template is for.</summary>
    public string? Description { get; set; }

    /// <summary>FK to the admin who created this template.</summary>
    public Guid CreatedByAdminId { get; set; }

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    /// <summary>Field definitions included in this template.</summary>
    public ICollection<ProjectTemplateField> Fields { get; set; } = new List<ProjectTemplateField>();

    /// <summary>Admin who created this template.</summary>
    public AppUser? CreatedByAdmin { get; set; }
}
