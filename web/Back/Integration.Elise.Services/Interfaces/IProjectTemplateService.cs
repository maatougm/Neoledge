/**
 * @file     IProjectTemplateService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for project template management
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Defines business-level operations for managing <c>ProjectTemplate</c> entities.
/// </summary>
public interface IProjectTemplateService
{
    /// <summary>Returns all templates as lightweight summaries.</summary>
    Task<Result<IEnumerable<ProjectTemplateSummaryDto>>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Returns full detail of a single template including its field definitions.</summary>
    Task<Result<ProjectTemplateDetailDto>> GetByIdAsync(Guid id, CancellationToken ct = default);

    /// <summary>Creates a new template with its field definitions.</summary>
    Task<Result<ProjectTemplateDetailDto>> CreateAsync(CreateProjectTemplateDto dto, Guid adminId, CancellationToken ct = default);

    /// <summary>Deletes a template and all its field definitions.</summary>
    Task<Result> DeleteAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Copies all Custom fields from the template into the target project,
    /// creating empty <c>ProjectFieldValue</c> rows for each copied field.
    /// </summary>
    Task<Result> ApplyToProjectAsync(Guid templateId, Guid projectId, CancellationToken ct = default);
}
