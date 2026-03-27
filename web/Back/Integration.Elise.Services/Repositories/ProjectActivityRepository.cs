/**
 * @file     ProjectActivityRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     EF Core implementation of IProjectActivityRepository
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Repositories;

/// <inheritdoc cref="IProjectActivityRepository"/>
public class ProjectActivityRepository : IProjectActivityRepository
{
    private readonly ApplicationDbContext _db;

    public ProjectActivityRepository(ApplicationDbContext db) => _db = db;

    /// <inheritdoc/>
    public async Task<IEnumerable<ProjectActivity>> GetByProjectIdAsync(Guid projectId, int limit = 50, CancellationToken ct = default)
        => await _db.ProjectActivities
                    .Where(a => a.ProjectId == projectId)
                    .Include(a => a.User)
                    .OrderByDescending(a => a.CreatedAt)
                    .Take(limit)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task AddAsync(ProjectActivity activity, CancellationToken ct = default)
    {
        await _db.ProjectActivities.AddAsync(activity, ct);
        await _db.SaveChangesAsync(ct);
    }
}
