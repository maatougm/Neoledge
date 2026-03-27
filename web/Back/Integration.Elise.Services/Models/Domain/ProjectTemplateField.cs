/**
 * @file     ProjectTemplateField.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     A single field definition belonging to a ProjectTemplate
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.Domain;

/// <summary>
/// Defines a single field within a <see cref="ProjectTemplate"/>.
/// When the template is applied to a project, these fields are copied as Custom <see cref="ProjectField"/> rows.
/// </summary>
public class ProjectTemplateField
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the owning template.</summary>
    public Guid TemplateId { get; set; }

    /// <summary>Display label shown in the questionnaire.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Input type for this field.</summary>
    public FieldType Type { get; set; }

    /// <summary>Field category — defaults to Custom for template-derived fields.</summary>
    public FieldCategory Category { get; set; } = FieldCategory.Custom;

    /// <summary>Whether a response to this field is mandatory.</summary>
    public bool IsRequired { get; set; }

    /// <summary>Position of this field relative to siblings within the template.</summary>
    public int DisplayOrder { get; set; }

    /// <summary>JSON-encoded list of options for Select-type fields.</summary>
    public string? Options { get; set; }

    // Navigation properties
    /// <summary>The template this field belongs to.</summary>
    public ProjectTemplate? Template { get; set; }
}
