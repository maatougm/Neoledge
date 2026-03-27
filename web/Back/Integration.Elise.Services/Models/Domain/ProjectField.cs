/**
 * @file     ProjectField.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Defines a field (schema) belonging to a project
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.Domain;

/// <summary>Defines a field schema attached to a project (label, type, validation rules).</summary>
public class ProjectField
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the owning project.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>Human-readable field label.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Data type of the field value.</summary>
    public FieldType FieldType { get; set; } = FieldType.Text;

    /// <summary>Whether a value is required for this field.</summary>
    public bool IsRequired { get; set; }

    /// <summary>Optional default value expressed as a string.</summary>
    public string? DefaultValue { get; set; }

    /// <summary>Display/sort order within the project form.</summary>
    public int OrderIndex { get; set; }

    /// <summary>Whether this field was auto-seeded, added by the PM, or custom.</summary>
    public FieldCategory FieldCategory { get; set; } = FieldCategory.Dynamic;

    /// <summary>JSON-encoded array of option labels for <see cref="FieldType.Select"/> fields. Null otherwise.</summary>
    public string? Options { get; set; }

    // Navigation property
    /// <summary>Parent project.</summary>
    public Project? Project { get; set; }

    /// <summary>Values recorded for this field across all project instances.</summary>
    public ICollection<ProjectFieldValue> Values { get; set; } = new List<ProjectFieldValue>();
}
