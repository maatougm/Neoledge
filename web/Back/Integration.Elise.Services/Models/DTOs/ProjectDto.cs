/**
 * @file     ProjectDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     DTOs and AutoMapper profile for Project CRUD operations
 */

using AutoMapper;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.DTOs;

// ─── Field DTOs ──────────────────────────────────────────────────────────────

/// <summary>Represents a field definition in responses.</summary>
public record ProjectFieldDto(
    Guid Id,
    string Label,
    FieldType FieldType,
    bool IsRequired,
    string? DefaultValue,
    int OrderIndex,
    FieldCategory FieldCategory,
    string? Options
);

/// <summary>Represents a field value in responses.</summary>
public record ProjectFieldValueDto(
    Guid ProjectFieldId,
    string Label,
    string? Value
);

// ─── Request DTOs ────────────────────────────────────────────────────────────

/// <summary>Payload for creating a new project.</summary>
public record CreateProjectDto(
    string Name,
    string ClientName,
    DateTime StartDate,
    DateTime EndDate,
    Guid? ProjectManagerId
);

/// <summary>Payload for updating project metadata.</summary>
public record UpdateProjectDto(
    string? Name,
    string? ClientName,
    DateTime? StartDate,
    DateTime? EndDate
);

/// <summary>Payload for assigning or replacing the project manager.</summary>
public record AssignProjectManagerDto(Guid ProjectManagerId);

/// <summary>Payload for adding a custom field to a project's questionnaire.</summary>
public record AddProjectFieldDto(
    string Label,
    FieldType FieldType,
    bool IsRequired,
    string? Options
);

/// <summary>Payload for duplicating an existing project under a new name.</summary>
public record DuplicateProjectDto(string Name);

/// <summary>Payload for bulk-archiving a set of projects.</summary>
public record BulkProjectIdsDto(IEnumerable<Guid> ProjectIds);

/// <summary>Payload for bulk-transitioning a set of projects to a new status.</summary>
public record BulkStatusDto(IEnumerable<Guid> ProjectIds, ProjectStatus Status);

/// <summary>Payload for bulk-assigning a project manager to a set of projects.</summary>
public record BulkAssignManagerDto(IEnumerable<Guid> ProjectIds, Guid ManagerId);

// ─── Activity Feed DTOs ──────────────────────────────────────────────────────

/// <summary>Represents a single project activity feed entry.</summary>
public record ProjectActivityDto(
    Guid Id,
    string? UserName,
    string Action,
    string? Detail,
    DateTime CreatedAt
);

// ─── Project Template DTOs ───────────────────────────────────────────────────

/// <summary>Represents a single field definition within a project template.</summary>
public record ProjectTemplateFieldDto(
    Guid Id,
    string Label,
    string Type,
    string Category,
    bool IsRequired,
    int DisplayOrder,
    string? Options
);

/// <summary>Lightweight template representation for list views.</summary>
public record ProjectTemplateSummaryDto(
    Guid Id,
    string Name,
    string? Description,
    int FieldCount,
    DateTime CreatedAt
);

/// <summary>Full template representation including its field definitions.</summary>
public record ProjectTemplateDetailDto(
    Guid Id,
    string Name,
    string? Description,
    DateTime CreatedAt,
    IEnumerable<ProjectTemplateFieldDto> Fields
);

/// <summary>Payload for creating a new project template.</summary>
public record CreateProjectTemplateDto(
    string Name,
    string? Description,
    IEnumerable<CreateTemplateFieldDto> Fields
);

/// <summary>Payload for a single field within a template creation request.</summary>
public record CreateTemplateFieldDto(
    string Label,
    string Type,
    string Category,
    bool IsRequired,
    int DisplayOrder,
    string? Options
);

// ─── Response DTOs ───────────────────────────────────────────────────────────

/// <summary>Lightweight project representation for list views.</summary>
public record ProjectSummaryDto(
    Guid Id,
    string Name,
    string ClientName,
    string? ProjectManagerName,
    string? ProjectManagerEmail,
    ProjectStatus Status,
    DateTime StartDate,
    DateTime EndDate,
    DateTime CreatedAt
);

/// <summary>Full project representation including fields and manager details.</summary>
public record ProjectDetailDto(
    Guid Id,
    string Name,
    string ClientName,
    ProjectStatus Status,
    bool AllowManagerCustomFields,
    string? AiOutput,
    DateTime StartDate,
    DateTime EndDate,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    UserResponseDto? ProjectManager,
    IEnumerable<ProjectFieldDto> Fields,
    IEnumerable<ProjectFieldValueDto> FieldValues
);

// ─── AutoMapper profile ──────────────────────────────────────────────────────

/// <summary>Maps between project entities and their DTOs.</summary>
public class ProjectMappingProfile : Profile
{
    public ProjectMappingProfile()
    {
        CreateMap<ProjectField, ProjectFieldDto>();

        CreateMap<Project, ProjectSummaryDto>()
            .ConstructUsing((src, ctx) => new ProjectSummaryDto(
                src.Id,
                src.Name,
                src.ClientName,
                src.ProjectManager != null ? $"{src.ProjectManager.FirstName} {src.ProjectManager.LastName}" : null,
                src.ProjectManager?.Email,
                src.Status,
                src.StartDate,
                src.EndDate,
                src.CreatedAt
            ));

        CreateMap<Project, ProjectDetailDto>()
            .ConstructUsing((src, ctx) => new ProjectDetailDto(
                src.Id,
                src.Name,
                src.ClientName,
                src.Status,
                src.AllowManagerCustomFields,
                src.AiOutput,
                src.StartDate,
                src.EndDate,
                src.CreatedAt,
                src.UpdatedAt,
                src.ProjectManager != null ? ctx.Mapper.Map<UserResponseDto>(src.ProjectManager) : null,
                ctx.Mapper.Map<IEnumerable<ProjectFieldDto>>(src.Fields),
                src.FieldValues.Select(fv => new ProjectFieldValueDto(
                    fv.ProjectFieldId,
                    fv.ProjectField?.Label ?? string.Empty,
                    fv.Value
                ))
            ));

        // ── Activity feed mapping ─────────────────────────────────────────────
        CreateMap<Integration.Elise.Services.Models.Domain.ProjectActivity, ProjectActivityDto>()
            .ConstructUsing((src, _) => new ProjectActivityDto(
                src.Id,
                src.User != null ? $"{src.User.FirstName} {src.User.LastName}" : "Système",
                src.Action,
                src.Detail,
                src.CreatedAt
            ));

        // ── Template summary mapping ──────────────────────────────────────────
        CreateMap<Integration.Elise.Services.Models.Domain.ProjectTemplate, ProjectTemplateSummaryDto>()
            .ConstructUsing((src, _) => new ProjectTemplateSummaryDto(
                src.Id,
                src.Name,
                src.Description,
                src.Fields.Count,
                src.CreatedAt
            ));
    }
}
