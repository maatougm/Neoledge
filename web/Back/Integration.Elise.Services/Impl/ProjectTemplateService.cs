/**
 * @file     ProjectTemplateService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Business logic for project template management and application
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Serilog;

namespace Integration.Elise.Services.Impl;

/// <inheritdoc cref="IProjectTemplateService"/>
public class ProjectTemplateService : IProjectTemplateService
{
    private readonly IProjectTemplateRepository _templateRepo;
    private readonly IProjectRepository _projectRepo;
    private readonly ApplicationDbContext _db;
    private readonly ILogger _logger;

    public ProjectTemplateService(
        IProjectTemplateRepository templateRepo,
        IProjectRepository projectRepo,
        ApplicationDbContext db,
        ILogger logger)
    {
        _templateRepo = templateRepo;
        _projectRepo  = projectRepo;
        _db           = db;
        _logger       = logger;
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectTemplateSummaryDto>>> GetAllAsync(CancellationToken ct = default)
    {
        var templates = await _templateRepo.GetAllAsync(ct);
        var dtos = templates.Select(t => new ProjectTemplateSummaryDto(
            t.Id,
            t.Name,
            t.Description,
            t.Fields.Count,
            t.CreatedAt
        ));
        return Result<IEnumerable<ProjectTemplateSummaryDto>>.Ok(dtos);
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectTemplateDetailDto>> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var template = await _templateRepo.GetByIdAsync(id, ct);
        if (template is null)
        {
            _logger.Warning("GetTemplateById — template {Id} not found", id);
            return Result<ProjectTemplateDetailDto>.Fail($"Modèle {id} introuvable.");
        }
        return Result<ProjectTemplateDetailDto>.Ok(MapToDetailDto(template));
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectTemplateDetailDto>> CreateAsync(CreateProjectTemplateDto dto, Guid adminId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            return Result<ProjectTemplateDetailDto>.Fail("Le nom du modèle est obligatoire.");

        var template = new ProjectTemplate
        {
            Name             = dto.Name,
            Description      = dto.Description,
            CreatedByAdminId = adminId
        };

        foreach (var fieldDto in dto.Fields.OrderBy(f => f.DisplayOrder))
        {
            if (!Enum.TryParse<FieldType>(fieldDto.Type, ignoreCase: true, out var fieldType))
                return Result<ProjectTemplateDetailDto>.Fail($"Type de champ invalide : '{fieldDto.Type}'.");

            if (!Enum.TryParse<FieldCategory>(fieldDto.Category, ignoreCase: true, out var fieldCategory))
                return Result<ProjectTemplateDetailDto>.Fail($"Catégorie de champ invalide : '{fieldDto.Category}'.");

            template.Fields.Add(new ProjectTemplateField
            {
                Label        = fieldDto.Label,
                Type         = fieldType,
                Category     = fieldCategory,
                IsRequired   = fieldDto.IsRequired,
                DisplayOrder = fieldDto.DisplayOrder,
                Options      = fieldDto.Options
            });
        }

        var created = await _templateRepo.AddAsync(template, ct);
        _logger.Information("CreateTemplate — created template {Id} ('{Name}')", created.Id, created.Name);
        return Result<ProjectTemplateDetailDto>.Ok(MapToDetailDto(created));
    }

    /// <inheritdoc/>
    public async Task<Result> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var template = await _templateRepo.GetByIdAsync(id, ct);
        if (template is null)
            return Result.Fail($"Modèle {id} introuvable.");

        await _templateRepo.DeleteAsync(id, ct);
        _logger.Information("DeleteTemplate — deleted template {Id}", id);
        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> ApplyToProjectAsync(Guid templateId, Guid projectId, CancellationToken ct = default)
    {
        var template = await _templateRepo.GetByIdAsync(templateId, ct);
        if (template is null)
            return Result.Fail($"Modèle {templateId} introuvable.");

        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        int nextOrder = project.Fields.Any()
            ? project.Fields.Max(f => f.OrderIndex) + 1
            : 0;

        foreach (var templateField in template.Fields.OrderBy(f => f.DisplayOrder))
        {
            var newField = new ProjectField
            {
                ProjectId     = projectId,
                Label         = templateField.Label,
                FieldType     = templateField.Type,
                IsRequired    = templateField.IsRequired,
                OrderIndex    = nextOrder++,
                FieldCategory = FieldCategory.Custom,
                Options       = templateField.Options
            };

            _db.ProjectFields.Add(newField);

            // Create an empty value row so the questionnaire UI can render the field immediately
            _db.ProjectFieldValues.Add(new ProjectFieldValue
            {
                ProjectId      = projectId,
                ProjectFieldId = newField.Id,
                Value          = null
            });
        }

        await _db.SaveChangesAsync(ct);
        _logger.Information(
            "ApplyTemplate — applied template {TemplateId} to project {ProjectId} ({FieldCount} fields)",
            templateId, projectId, template.Fields.Count);

        return Result.Ok();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static ProjectTemplateDetailDto MapToDetailDto(ProjectTemplate t)
        => new(
            t.Id,
            t.Name,
            t.Description,
            t.CreatedAt,
            t.Fields.OrderBy(f => f.DisplayOrder).Select(f => new ProjectTemplateFieldDto(
                f.Id,
                f.Label,
                f.Type.ToString(),
                f.Category.ToString(),
                f.IsRequired,
                f.DisplayOrder,
                f.Options
            ))
        );
}
