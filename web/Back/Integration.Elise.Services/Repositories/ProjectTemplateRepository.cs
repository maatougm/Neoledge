/**
 * @file     ProjectTemplateRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     EF Core implementation of IProjectTemplateRepository
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Repositories;

/// <inheritdoc cref="IProjectTemplateRepository"/>
public class ProjectTemplateRepository : IProjectTemplateRepository
{
    private readonly ApplicationDbContext _db;

    public ProjectTemplateRepository(ApplicationDbContext db) => _db = db;

    /// <inheritdoc/>
    public async Task<IEnumerable<ProjectTemplate>> GetAllAsync(CancellationToken ct = default)
        => await _db.ProjectTemplates
                    .Include(t => t.Fields)
                    .OrderBy(t => t.Name)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<ProjectTemplate?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.ProjectTemplates
                    .Include(t => t.Fields.OrderBy(f => f.DisplayOrder))
                    .FirstOrDefaultAsync(t => t.Id == id, ct);

    /// <inheritdoc/>
    public async Task<ProjectTemplate> AddAsync(ProjectTemplate template, CancellationToken ct = default)
    {
        _db.ProjectTemplates.Add(template);
        await _db.SaveChangesAsync(ct);
        return template;
    }

    /// <inheritdoc/>
    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        await _db.ProjectTemplates
                 .Where(t => t.Id == id)
                 .ExecuteDeleteAsync(ct);
    }
}
