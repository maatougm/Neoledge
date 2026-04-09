/**
 * @file     ProjectService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Business logic for project lifecycle — creation, PM assignment, status transitions
 */

using AutoMapper;
using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Integration.Elise.Services.Services;
using Microsoft.EntityFrameworkCore;
using Serilog;

namespace Integration.Elise.Services.Impl;

/// <inheritdoc cref="IProjectService"/>
public class ProjectService : IProjectService
{
    private readonly IProjectRepository _projectRepo;
    private readonly IAppUserRepository _userRepo;
    private readonly IMapper _mapper;
    private readonly ILogger _logger;
    private readonly IPhaseGateService _phaseGate;
    private readonly ApplicationDbContext _db;
    private readonly IEmailService _email;
    private readonly IProjectActivityRepository _activityRepo;

    /// <summary>Static field definitions auto-seeded on every new project.</summary>
    private static readonly IReadOnlyList<(string Label, FieldType Type, bool Required)> StaticFields =
    [
        ("Description", FieldType.Text, false),
        ("Budget prévisionnel", FieldType.Number, false),
        ("Type de déploiement", FieldType.Select, true),
        ("Environnement cible", FieldType.Text, true),
        ("Priorité", FieldType.Select, true),
        ("Validation client requise", FieldType.Checkbox, false),
    ];

    public ProjectService(
        IProjectRepository projectRepo,
        IAppUserRepository userRepo,
        IMapper mapper,
        ILogger logger,
        IPhaseGateService phaseGate,
        ApplicationDbContext db,
        IEmailService email,
        IProjectActivityRepository activityRepo)
    {
        _projectRepo  = projectRepo;
        _userRepo     = userRepo;
        _mapper       = mapper;
        _logger       = logger;
        _phaseGate    = phaseGate;
        _db           = db;
        _email        = email;
        _activityRepo = activityRepo;
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectSummaryDto>>> GetAllProjectsAsync(CancellationToken ct = default)
    {
        var projects = await _projectRepo.GetAllAsync(ct);
        return Result<IEnumerable<ProjectSummaryDto>>.Ok(_mapper.Map<IEnumerable<ProjectSummaryDto>>(projects));
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectDetailDto>> GetProjectByIdAsync(Guid id, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(id, ct);
        if (project is null)
        {
            _logger.Warning("GetProjectById — project {Id} not found", id);
            return Result<ProjectDetailDto>.Fail($"Projet {id} introuvable.");
        }
        return Result<ProjectDetailDto>.Ok(_mapper.Map<ProjectDetailDto>(project));
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectSummaryDto>>> GetMyProjectsAsync(Guid managerId, CancellationToken ct = default)
    {
        var projects = await _projectRepo.GetByManagerIdAsync(managerId, ct);
        return Result<IEnumerable<ProjectSummaryDto>>.Ok(_mapper.Map<IEnumerable<ProjectSummaryDto>>(projects));
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectSummaryDto>>> GetProjectsByStatusAsync(ProjectStatus status, CancellationToken ct = default)
    {
        var projects = await _projectRepo.GetByStatusAsync(status, ct);
        return Result<IEnumerable<ProjectSummaryDto>>.Ok(_mapper.Map<IEnumerable<ProjectSummaryDto>>(projects));
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectDetailDto>> CreateProjectAsync(Guid adminId, CreateProjectDto dto, CancellationToken ct = default)
    {
        if (dto.EndDate <= dto.StartDate)
            return Result<ProjectDetailDto>.Fail("La date de fin doit être postérieure à la date de début.");

        if (dto.ProjectManagerId.HasValue)
        {
            var pm = await _userRepo.GetByIdAsync(dto.ProjectManagerId.Value, ct);
            if (pm is null || pm.Role != UserRole.ProjectManager)
                return Result<ProjectDetailDto>.Fail("Le chef de projet spécifié est invalide ou n'a pas le rôle requis.");
        }

        var project = new Project
        {
            Name              = dto.Name,
            ClientName        = dto.ClientName,
            StartDate         = dto.StartDate,
            EndDate           = dto.EndDate,
            ProjectManagerId  = dto.ProjectManagerId,
            CreatedByAdminId  = adminId,
            Status            = ProjectStatus.Draft
        };

        // Auto-seed static fields
        int order = 0;
        foreach (var (label, type, required) in StaticFields)
        {
            project.Fields.Add(new ProjectField
            {
                Label         = label,
                FieldType     = type,
                IsRequired    = required,
                OrderIndex    = order++,
                FieldCategory = FieldCategory.Static
            });
        }

        var created = await _projectRepo.CreateAsync(project, ct);
        _logger.Information("CreateProject — created project {Id} ({Name})", created.Id, created.Name);

        await _activityRepo.AddAsync(new ProjectActivity
        {
            ProjectId = created.Id,
            Action    = "ProjectCreated",
            Detail    = created.Name
        }, ct);

        var detail = await _projectRepo.GetByIdWithDetailsAsync(created.Id, ct);
        return Result<ProjectDetailDto>.Ok(_mapper.Map<ProjectDetailDto>(detail!));
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectDetailDto>> UpdateProjectAsync(Guid id, UpdateProjectDto dto, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(id, ct);
        if (project is null)
            return Result<ProjectDetailDto>.Fail($"Projet {id} introuvable.");

        if (dto.Name        is not null) project.Name       = dto.Name;
        if (dto.ClientName  is not null) project.ClientName = dto.ClientName;
        if (dto.StartDate   is not null) project.StartDate  = dto.StartDate.Value;
        if (dto.EndDate     is not null) project.EndDate    = dto.EndDate.Value;

        if (project.EndDate <= project.StartDate)
            return Result<ProjectDetailDto>.Fail("La date de fin doit être postérieure à la date de début.");

        await _projectRepo.UpdateAsync(project, ct);
        _logger.Information("UpdateProject — updated project {Id}", id);
        return Result<ProjectDetailDto>.Ok(_mapper.Map<ProjectDetailDto>(project));
    }

    /// <inheritdoc/>
    public async Task<Result> DeleteProjectAsync(Guid id, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(id, ct);
        if (project is null)
            return Result.Fail($"Projet {id} introuvable.");

        await _projectRepo.DeleteAsync(id, ct);
        _logger.Information("DeleteProject — deleted project {Id}", id);
        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> AssignProjectManagerAsync(Guid projectId, Guid managerId, CancellationToken ct = default)
    {
        var pm = await _userRepo.GetByIdAsync(managerId, ct);
        if (pm is null || pm.Role != UserRole.ProjectManager || !pm.IsActive)
            return Result.Fail("Le chef de projet spécifié est invalide, inactif ou n'a pas le rôle requis.");

        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        await _projectRepo.AssignManagerAsync(projectId, managerId, ct);
        _logger.Information("AssignManager — project {ProjectId} assigned to {ManagerId}", projectId, managerId);

        await _activityRepo.AddAsync(new ProjectActivity
        {
            ProjectId = projectId,
            UserId    = managerId,
            Action    = "ManagerAssigned",
            Detail    = $"{pm.FirstName} {pm.LastName}"
        }, ct);

        // Notify the newly assigned manager — failures must not break the main operation
        try
        {
            await _email.SendProjectAssignedAsync(pm.Email, pm.FirstName, project.Name, ct);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "AssignManager — email notification failed for manager {ManagerId}", managerId);
        }

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> UpdateProjectStatusAsync(Guid projectId, ProjectStatus status, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        var oldStatus = project.Status;

        var (allowed, reason) = await _phaseGate.CanTransitionAsync(projectId, oldStatus, status, ct);
        if (!allowed)
            return Result.Fail(reason ?? "Transition non autorisée.");

        await _projectRepo.UpdateStatusAsync(projectId, status, ct);
        _logger.Information("UpdateStatus — project {ProjectId} → {Status}", projectId, status);

        await _activityRepo.AddAsync(new ProjectActivity
        {
            ProjectId = projectId,
            Action    = "StatusChanged",
            Detail    = $"{oldStatus} → {status}"
        }, ct);

        // Notify the project manager if one is assigned — failures must not break the main operation
        if (project.ProjectManagerId.HasValue)
        {
            try
            {
                var manager = await _userRepo.GetByIdAsync(project.ProjectManagerId.Value, ct);
                if (manager is not null)
                {
                    await _email.SendStatusChangedAsync(
                        manager.Email,
                        manager.FirstName,
                        project.Name,
                        oldStatus.ToString(),
                        status.ToString(),
                        ct);
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "UpdateStatus — email notification failed for project {ProjectId}", projectId);
            }
        }

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> ArchiveProjectAsync(Guid projectId, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        await _projectRepo.UpdateStatusAsync(projectId, ProjectStatus.Archived, ct);
        _logger.Information("ArchiveProject — archived project {ProjectId}", projectId);

        await _activityRepo.AddAsync(new ProjectActivity
        {
            ProjectId = projectId,
            Action    = "StatusChanged",
            Detail    = "→ Archivé"
        }, ct);

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result<ProjectFieldDto>> AddCustomFieldAsync(Guid projectId, AddProjectFieldDto dto, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result<ProjectFieldDto>.Fail($"Projet {projectId} introuvable.");

        int nextOrder = project.Fields.Any() ? project.Fields.Max(f => f.OrderIndex) + 1 : 0;

        var field = new ProjectField
        {
            ProjectId     = projectId,
            Label         = dto.Label,
            FieldType     = dto.FieldType,
            IsRequired    = dto.IsRequired,
            OrderIndex    = nextOrder,
            FieldCategory = FieldCategory.Custom,
            Options       = dto.Options
        };

        await _projectRepo.AddFieldAsync(field, ct);
        _logger.Information("AddCustomField — added field '{Label}' to project {ProjectId}", dto.Label, projectId);
        return Result<ProjectFieldDto>.Ok(_mapper.Map<ProjectFieldDto>(field));
    }

    /// <inheritdoc/>
    public async Task<Result> RemoveFieldAsync(Guid projectId, Guid fieldId, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        var field = project.Fields.FirstOrDefault(f => f.Id == fieldId);
        if (field is null)
            return Result.Fail($"Champ {fieldId} introuvable dans ce projet.");

        if (field.FieldCategory == FieldCategory.Static)
            return Result.Fail("Les champs statiques ne peuvent pas être supprimés.");

        await _projectRepo.RemoveFieldAsync(fieldId, ct);
        _logger.Information("RemoveField — removed field {FieldId} from project {ProjectId}", fieldId, projectId);
        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> ToggleManagerFieldsAsync(Guid projectId, bool allow, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        await _projectRepo.SetManagerFieldsPermissionAsync(projectId, allow, ct);
        _logger.Information(
            "ToggleManagerFields — project {ProjectId} AllowManagerCustomFields → {Allow}",
            projectId, allow);
        return Result.Ok();
    }

    // ── Feature 2: Project Duplication ────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<Result<ProjectDetailDto>> DuplicateProjectAsync(Guid projectId, string newName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(newName))
            return Result<ProjectDetailDto>.Fail("Le nom du projet dupliqué est obligatoire.");

        var source = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (source is null)
            return Result<ProjectDetailDto>.Fail($"Projet {projectId} introuvable.");

        // Build new project — reset transient state
        var duplicate = new Project
        {
            Name             = newName,
            ClientName       = source.ClientName,
            Status           = ProjectStatus.Draft,
            AllowManagerCustomFields = false,
            CreatedByAdminId = source.CreatedByAdminId,
            // ProjectManagerId intentionally left null
            // StartDate / EndDate left as default — no dates on a blank duplicate
        };

        // Copy field definitions (new Guids to decouple from source)
        var fieldIdMap = new Dictionary<Guid, Guid>(); // old → new
        foreach (var sourceField in source.Fields.OrderBy(f => f.OrderIndex))
        {
            var newFieldId = Guid.NewGuid();
            fieldIdMap[sourceField.Id] = newFieldId;

            duplicate.Fields.Add(new ProjectField
            {
                Id            = newFieldId,
                ProjectId     = duplicate.Id,
                Label         = sourceField.Label,
                FieldType     = sourceField.FieldType,
                IsRequired    = sourceField.IsRequired,
                DefaultValue  = sourceField.DefaultValue,
                OrderIndex    = sourceField.OrderIndex,
                FieldCategory = sourceField.FieldCategory,
                Options       = sourceField.Options,
            });
        }

        // Copy field values for Static fields only — Dynamic/Custom start empty
        foreach (var fv in source.FieldValues)
        {
            var sourceField = source.Fields.FirstOrDefault(f => f.Id == fv.ProjectFieldId);
            if (sourceField?.FieldCategory != FieldCategory.Static) continue;

            if (!fieldIdMap.TryGetValue(fv.ProjectFieldId, out var newFieldId)) continue;

            duplicate.FieldValues.Add(new ProjectFieldValue
            {
                ProjectId      = duplicate.Id,
                ProjectFieldId = newFieldId,
                Value          = fv.Value,
            });
        }

        var created = await _projectRepo.CreateAsync(duplicate, ct);
        _logger.Information(
            "DuplicateProject — project {SourceId} duplicated as {NewId} ('{NewName}')",
            projectId, created.Id, newName);

        var detail = await _projectRepo.GetByIdWithDetailsAsync(created.Id, ct);
        return Result<ProjectDetailDto>.Ok(_mapper.Map<ProjectDetailDto>(detail!));
    }

    // ── Feature 3: Bulk Operations ────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<Result> BulkArchiveAsync(IEnumerable<Guid> projectIds, CancellationToken ct = default)
    {
        var ids = projectIds.ToList();
        if (ids.Count == 0)
            return Result.Fail("Aucun identifiant de projet fourni.");

        var projects = await _db.Projects
            .Where(p => ids.Contains(p.Id))
            .ToListAsync(ct);

        foreach (var project in projects)
        {
            project.Status    = ProjectStatus.Archived;
            project.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        _logger.Information("BulkArchive — archived {Count} projects", projects.Count);
        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> BulkUpdateStatusAsync(IEnumerable<Guid> projectIds, ProjectStatus status, CancellationToken ct = default)
    {
        var ids = projectIds.ToList();
        if (ids.Count == 0)
            return Result.Fail("Aucun identifiant de projet fourni.");

        var projects = await _db.Projects
            .Where(p => ids.Contains(p.Id))
            .ToListAsync(ct);

        var skipped = new List<string>();

        foreach (var project in projects)
        {
            var (allowed, reason) = await _phaseGate.CanTransitionAsync(project.Id, project.Status, status, ct);
            if (!allowed)
            {
                skipped.Add($"{project.Id}: {reason}");
                continue;
            }

            project.Status    = status;
            project.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);

        var updatedCount = projects.Count - skipped.Count;
        _logger.Information(
            "BulkUpdateStatus — {Updated} updated, {Skipped} skipped",
            updatedCount, skipped.Count);

        if (skipped.Count > 0)
        {
            var summary = string.Join("; ", skipped);
            return Result.Fail(
                $"{updatedCount} projet(s) mis à jour. {skipped.Count} ignoré(s) : {summary}");
        }

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> BulkAssignManagerAsync(IEnumerable<Guid> projectIds, Guid managerId, CancellationToken ct = default)
    {
        var ids = projectIds.ToList();
        if (ids.Count == 0)
            return Result.Fail("Aucun identifiant de projet fourni.");

        var manager = await _userRepo.GetByIdAsync(managerId, ct);
        if (manager is null || manager.Role != UserRole.ProjectManager || !manager.IsActive)
            return Result.Fail("Le chef de projet spécifié est invalide, inactif ou n'a pas le rôle requis.");

        var projects = await _db.Projects
            .Where(p => ids.Contains(p.Id))
            .ToListAsync(ct);

        foreach (var project in projects)
        {
            project.ProjectManagerId = managerId;
            project.UpdatedAt        = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        _logger.Information(
            "BulkAssignManager — {Count} projects assigned to manager {ManagerId}",
            projects.Count, managerId);
        return Result.Ok();
    }

    // ── Feature 4: Activity Feed ───────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectActivityDto>>> GetActivityAsync(Guid projectId, CancellationToken ct = default)
    {
        var project = await _projectRepo.GetByIdWithDetailsAsync(projectId, ct);
        if (project is null)
            return Result<IEnumerable<ProjectActivityDto>>.Fail($"Projet {projectId} introuvable.");

        var activities = await _activityRepo.GetByProjectIdAsync(projectId, ct: ct);
        var dtos = activities.Select(a => new ProjectActivityDto(
            a.Id,
            a.User != null ? $"{a.User.FirstName} {a.User.LastName}" : "Système",
            a.Action,
            a.Detail,
            a.CreatedAt
        ));
        return Result<IEnumerable<ProjectActivityDto>>.Ok(dtos);
    }

    // ── New Features: Soft Delete, Search, Priority ───────────────────────────

    /// <inheritdoc/>
    public async Task<Result> SoftDeleteProjectAsync(Guid projectId, Guid deletedByUserId, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { projectId }, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        project.IsDeleted = true;
        project.DeletedAt = DateTime.UtcNow;
        project.DeletedByUserId = deletedByUserId;

        await _db.SaveChangesAsync(ct);
        _logger.Information("SoftDeleteProject — project {ProjectId} soft-deleted by user {UserId}", projectId, deletedByUserId);

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> RestoreProjectAsync(Guid projectId, CancellationToken ct = default)
    {
        var project = await _db.Projects
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == projectId, ct);

        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        if (!project.IsDeleted)
            return Result.Fail("Le projet n'est pas supprimé.");

        project.IsDeleted = false;
        project.DeletedAt = null;
        project.DeletedByUserId = null;

        await _db.SaveChangesAsync(ct);
        _logger.Information("RestoreProject — project {ProjectId} restored", projectId);

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectSummaryDto>>> GetDeletedProjectsAsync(CancellationToken ct = default)
    {
        var projects = await _db.Projects
            .IgnoreQueryFilters()
            .Where(p => p.IsDeleted)
            .Include(p => p.ProjectManager)
            .OrderByDescending(p => p.DeletedAt)
            .ToListAsync(ct);

        return Result<IEnumerable<ProjectSummaryDto>>.Ok(_mapper.Map<IEnumerable<ProjectSummaryDto>>(projects));
    }

    /// <inheritdoc/>
    public async Task<Result<PagedResultDto<ProjectSummaryDto>>> SearchProjectsAsync(ProjectSearchFilterDto filter, CancellationToken ct = default)
    {
        var query = _db.Projects.AsQueryable();

        // Search term
        if (!string.IsNullOrWhiteSpace(filter.SearchTerm))
        {
            var term = filter.SearchTerm.ToLower();
            query = query.Where(p =>
                p.Name.ToLower().Contains(term) ||
                p.ClientName.ToLower().Contains(term) ||
                (p.Tags != null && p.Tags.ToLower().Contains(term)));
        }

        // Status filter
        if (!string.IsNullOrWhiteSpace(filter.Status) && Enum.TryParse<ProjectStatus>(filter.Status, out var status))
        {
            query = query.Where(p => p.Status == status);
        }

        // Priority filter
        if (!string.IsNullOrWhiteSpace(filter.Priority) && Enum.TryParse<ProjectPriority>(filter.Priority, out var priority))
        {
            query = query.Where(p => p.Priority == priority);
        }

        // Project Manager filter
        if (filter.ProjectManagerId.HasValue)
        {
            query = query.Where(p => p.ProjectManagerId == filter.ProjectManagerId.Value);
        }

        // Date range filters
        if (filter.StartDateFrom.HasValue)
            query = query.Where(p => p.StartDate >= filter.StartDateFrom.Value);
        if (filter.StartDateTo.HasValue)
            query = query.Where(p => p.StartDate <= filter.StartDateTo.Value);
        if (filter.EndDateFrom.HasValue)
            query = query.Where(p => p.EndDate >= filter.EndDateFrom.Value);
        if (filter.EndDateTo.HasValue)
            query = query.Where(p => p.EndDate <= filter.EndDateTo.Value);

        // Include manager info
        query = query.Include(p => p.ProjectManager);

        // Sorting
        query = filter.SortBy?.ToLower() switch
        {
            "name" => filter.SortDescending ? query.OrderByDescending(p => p.Name) : query.OrderBy(p => p.Name),
            "client" => filter.SortDescending ? query.OrderByDescending(p => p.ClientName) : query.OrderBy(p => p.ClientName),
            "startdate" => filter.SortDescending ? query.OrderByDescending(p => p.StartDate) : query.OrderBy(p => p.StartDate),
            "enddate" => filter.SortDescending ? query.OrderByDescending(p => p.EndDate) : query.OrderBy(p => p.EndDate),
            "priority" => filter.SortDescending ? query.OrderByDescending(p => p.Priority) : query.OrderBy(p => p.Priority),
            _ => filter.SortDescending ? query.OrderByDescending(p => p.CreatedAt) : query.OrderBy(p => p.CreatedAt),
        };

        // Pagination
        var totalCount = await query.CountAsync(ct);
        var totalPages = (int)Math.Ceiling(totalCount / (double)filter.PageSize);

        var items = await query
            .Skip((filter.PageNumber - 1) * filter.PageSize)
            .Take(filter.PageSize)
            .ToListAsync(ct);

        var dtos = _mapper.Map<List<ProjectSummaryDto>>(items);

        return Result<PagedResultDto<ProjectSummaryDto>>.Ok(new PagedResultDto<ProjectSummaryDto>(
            dtos, totalCount, filter.PageNumber, filter.PageSize, totalPages));
    }

    /// <inheritdoc/>
    public async Task<Result<IEnumerable<ProjectSummaryDto>>> GetProjectsByPriorityAsync(ProjectPriority priority, CancellationToken ct = default)
    {
        var projects = await _db.Projects
            .Where(p => p.Priority == priority)
            .Include(p => p.ProjectManager)
            .ToListAsync(ct);

        return Result<IEnumerable<ProjectSummaryDto>>.Ok(_mapper.Map<IEnumerable<ProjectSummaryDto>>(projects));
    }

    /// <inheritdoc/>
    public async Task<Result> UpdateProjectPriorityAsync(Guid projectId, ProjectPriority priority, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { projectId }, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        project.Priority = priority;
        project.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        _logger.Information("UpdateProjectPriority — project {ProjectId} priority set to {Priority}", projectId, priority);

        return Result.Ok();
    }

    /// <inheritdoc/>
    public async Task<Result> UpdateProjectTagsAsync(Guid projectId, string tags, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { projectId }, ct);
        if (project is null)
            return Result.Fail($"Projet {projectId} introuvable.");

        project.Tags = tags;
        project.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        _logger.Information("UpdateProjectTags — project {ProjectId} tags updated", projectId);

        return Result.Ok();
    }

    // ── Pagination ───────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<Result<PaginatedResult<ProjectSummaryDto>>> GetProjectsPagedAsync(
        int skip, int take, string? search, string? status, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 100);
        if (skip < 0) skip = 0;

        var query = _db.Projects
            .Include(p => p.ProjectManager)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.ToLower();
            query = query.Where(p =>
                p.Name.ToLower().Contains(term) ||
                p.ClientName.ToLower().Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<ProjectStatus>(status, ignoreCase: true, out var parsedStatus))
        {
            query = query.Where(p => p.Status == parsedStatus);
        }

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(p => p.CreatedAt)
            .Skip(skip)
            .Take(take)
            .ToListAsync(ct);

        var dtos = _mapper.Map<List<ProjectSummaryDto>>(items);

        return Result<PaginatedResult<ProjectSummaryDto>>.Ok(
            new PaginatedResult<ProjectSummaryDto>(dtos, total, skip, take));
    }
}

