/**
 * @file     ProjectFieldValue.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Stores the actual value for a ProjectField within a Project
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>Stores a runtime value for a <see cref="ProjectField"/> within a given project.</summary>
public class ProjectFieldValue
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the owning project.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>FK to the field definition.</summary>
    public Guid ProjectFieldId { get; set; }

    /// <summary>String-encoded value — interpretation depends on <see cref="ProjectField.FieldType"/>.</summary>
    public string? Value { get; set; }

    // Navigation properties
    /// <summary>Parent project.</summary>
    public Project? Project { get; set; }

    /// <summary>Field definition.</summary>
    public ProjectField? ProjectField { get; set; }
}
