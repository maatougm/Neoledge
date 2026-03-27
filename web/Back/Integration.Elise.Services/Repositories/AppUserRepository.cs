/**
 * @file     AppUserRepository.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     EF Core implementation of IAppUserRepository
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Repositories;

/// <inheritdoc cref="IAppUserRepository"/>
public class AppUserRepository : IAppUserRepository
{
    private readonly ApplicationDbContext _db;

    public AppUserRepository(ApplicationDbContext db)
    {
        _db = db;
    }

    /// <inheritdoc/>
    public async Task<IEnumerable<AppUser>> GetAllAsync(CancellationToken ct = default)
        => await _db.AppUsers
                    .OrderBy(u => u.LastName)
                    .ThenBy(u => u.FirstName)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<AppUser?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.AppUsers.FirstOrDefaultAsync(u => u.Id == id, ct);

    /// <inheritdoc/>
    public async Task<AppUser?> GetByEmailAsync(string email, CancellationToken ct = default)
        => await _db.AppUsers
                    .FirstOrDefaultAsync(u => u.Email.ToLower() == email.ToLower(), ct);

    /// <inheritdoc/>
    public async Task<IEnumerable<AppUser>> GetByRoleAsync(UserRole role, CancellationToken ct = default)
        => await _db.AppUsers
                    .Where(u => u.Role == role && u.IsActive)
                    .OrderBy(u => u.LastName)
                    .ToListAsync(ct);

    /// <inheritdoc/>
    public async Task<bool> ExistsAsync(string email, CancellationToken ct = default)
        => await _db.AppUsers.AnyAsync(u => u.Email.ToLower() == email.ToLower(), ct);

    /// <inheritdoc/>
    public async Task<AppUser> CreateAsync(AppUser user, CancellationToken ct = default)
    {
        _db.AppUsers.Add(user);
        await _db.SaveChangesAsync(ct);
        return user;
    }

    /// <inheritdoc/>
    public async Task UpdateAsync(AppUser user, CancellationToken ct = default)
    {
        _db.AppUsers.Update(user);
        await _db.SaveChangesAsync(ct);
    }

    /// <inheritdoc/>
    public async Task SoftDeleteAsync(Guid id, CancellationToken ct = default)
    {
        var user = await _db.AppUsers.FindAsync(new object[] { id }, ct);
        if (user is not null)
        {
            user.IsActive = false;
            await _db.SaveChangesAsync(ct);
        }
    }
}
