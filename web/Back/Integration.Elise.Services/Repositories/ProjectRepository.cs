/**
 * @file     ProjectRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     EF Core implementation of IProjectRepository — eager-loads PM and fields
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Repositories;

/// <inheritdoc cref="IProjectRepository"/>
public class ProjectRepository : IProjectRepository
{
    private readonly ApplicationDbContext _db;

    public ProjectRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    /// <inheritdoc/>
    public async Task<IEnumerable<Project>> GetAllAsync(CancellationToken ct = default)
        => await _db.Projects
                    .Include(p => p.ProjectManager)
                    .OrderByDescending(p => p.CreatedAt)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<Project?> GetByIdWithDetailsAsync(Guid id, CancellationToken ct = default)
        => await _db.Projects
                    .Include(p => p.ProjectManager)
                    .Include(p => p.Fields.OrderBy(f => f.OrderIndex))
                    .Include(p => p.FieldValues)
                        .ThenInclude(v => v.ProjectField)
                    .FirstOrDefaultAsync(p => p.Id == id, ct);

    /// <inheritdoc/>
    public async Task<IEnumerable<Project>> GetByManagerIdAsync(Guid managerId, CancellationToken ct = default)
        => await _db.Projects
                    .Include(p => p.ProjectManager)
                    .Where(p => p.ProjectManagerId == managerId)
                    .OrderByDescending(p => p.CreatedAt)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<IEnumerable<Project>> GetByStatusAsync(ProjectStatus status, CancellationToken ct = default)
        => await _db.Projects
                    .Include(p => p.ProjectManager)
                    .Where(p => p.Status == status)
                    .OrderByDescending(p => p.CreatedAt)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<Project> CreateAsync(Project project, CancellationToken ct = default)
    {
        _db.Projects.Add(project);
        await _db.SaveChangesAsync(ct);
        return project;
    }

    /// <inheritdoc/>
    public async Task UpdateAsync(Project project, CancellationToken ct = default)
    {
        project.UpdatedAt = DateTime.UtcNow;
        _db.Projects.Update(project);
        await _db.SaveChangesAsync(ct);
    }

    /// <inheritdoc/>
    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { id }, ct);
        if (project is not null)
        {
            _db.Projects.Remove(project);
            await _db.SaveChangesAsync(ct);
        }
    }

    /// <inheritdoc/>
    public async Task AssignManagerAsync(Guid projectId, Guid managerId, CancellationToken ct = default)
    {
        await _db.Projects
                 .Where(p => p.Id == projectId)
                 .ExecuteUpdateAsync(s => s
                     .SetProperty(p => p.ProjectManagerId, managerId)
                     .SetProperty(p => p.UpdatedAt, DateTime.UtcNow), ct);
    }

    /// <inheritdoc/>
    public async Task UpdateStatusAsync(Guid projectId, ProjectStatus status, CancellationToken ct = default)
    {
        await _db.Projects
                 .Where(p => p.Id == projectId)
                 .ExecuteUpdateAsync(s => s
                     .SetProperty(p => p.Status, status)
                     .SetProperty(p => p.UpdatedAt, DateTime.UtcNow), ct);
    }

    /// <inheritdoc/>
    public async Task AddFieldAsync(ProjectField field, CancellationToken ct = default)
    {
        _db.ProjectFields.Add(field);
        await _db.SaveChangesAsync(ct);
    }

    /// <inheritdoc/>
    public async Task RemoveFieldAsync(Guid fieldId, CancellationToken ct = default)
    {
        await _db.ProjectFields
                 .Where(f => f.Id == fieldId)
                 .ExecuteDeleteAsync(ct);
    }

    /// <inheritdoc/>
    public async Task SetManagerFieldsPermissionAsync(Guid projectId, bool allow, CancellationToken ct = default)
    {
        await _db.Projects
                 .Where(p => p.Id == projectId)
                 .ExecuteUpdateAsync(s => s
                     .SetProperty(p => p.AllowManagerCustomFields, allow)
                     .SetProperty(p => p.UpdatedAt, DateTime.UtcNow), ct);
    }

    /// <inheritdoc/>
    /// <summary>Bulk-upserts field values for a project questionnaire.</summary>
    public async Task SaveFieldValuesAsync(Guid projectId, IEnumerable<(Guid FieldId, string? Value)> values, CancellationToken ct = default)
    {
        foreach (var (fieldId, value) in values)
        {
            var existing = await _db.ProjectFieldValues
                .FirstOrDefaultAsync(fv => fv.ProjectId == projectId && fv.ProjectFieldId == fieldId, ct);

            if (existing is not null)
            {
                existing.Value = value;
            }
            else
            {
                _db.ProjectFieldValues.Add(new ProjectFieldValue
                {
                    ProjectId      = projectId,
                    ProjectFieldId = fieldId,
                    Value          = value
                });
            }
        }
        await _db.SaveChangesAsync(ct);
    }
}
