/**
 * @file     ProjectValidationRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     EF Core implementation of IProjectValidationRepository
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Repositories;

/// <inheritdoc cref="IProjectValidationRepository"/>
public class ProjectValidationRepository : IProjectValidationRepository
{
    private readonly ApplicationDbContext _db;

    public ProjectValidationRepository(ApplicationDbContext db) => _db = db;

    /// <inheritdoc/>
    public async Task<IEnumerable<ProjectValidation>> GetByProjectIdAsync(Guid projectId, CancellationToken ct = default)
        => await _db.ProjectValidations
                    .Include(v => v.ValidatedBy)
                    .Where(v => v.ProjectId == projectId)
                    .OrderByDescending(v => v.ValidatedAt)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<ProjectValidation> AddAsync(ProjectValidation validation, CancellationToken ct = default)
    {
        _db.ProjectValidations.Add(validation);
        await _db.SaveChangesAsync(ct);
        return validation;
    }
}
