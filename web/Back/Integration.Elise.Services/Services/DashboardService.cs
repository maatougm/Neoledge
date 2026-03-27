/**
 * @file     DashboardService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Dashboard statistics and metrics service
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Serilog;

namespace Integration.Elise.Services.Services;

/// <inheritdoc />
public class DashboardService : IDashboardService
{
    private readonly ApplicationDbContext _db;

    public DashboardService(ApplicationDbContext db)
    {
        _db = db;
    }

    /// <inheritdoc />
    public async Task<Result<DashboardStatsDto>> GetDashboardStatsAsync(CancellationToken ct = default)
    {
        var totalProjects = await _db.Projects.CountAsync(ct);
        var activeProjects = await _db.Projects
            .Where(p => p.Status != ProjectStatus.Completed && p.Status != ProjectStatus.Archived)
            .CountAsync(ct);
        var completedProjects = await _db.Projects
            .Where(p => p.Status == ProjectStatus.Completed)
            .CountAsync(ct);
        var archivedProjects = await _db.Projects
            .Where(p => p.Status == ProjectStatus.Archived)
            .CountAsync(ct);

        var now = DateTime.UtcNow;
        var overdueProjects = await _db.Projects
            .Where(p => p.EndDate < now && p.Status != ProjectStatus.Completed && p.Status != ProjectStatus.Archived)
            .CountAsync(ct);

        var startOfMonth = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var projectsThisMonth = await _db.Projects
            .Where(p => p.CreatedAt >= startOfMonth)
            .CountAsync(ct);

        var projectsByStatus = await _db.Projects
            .GroupBy(p => p.Status.ToString())
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, ct);

        var projectsByPriority = await _db.Projects
            .GroupBy(p => p.Priority.ToString())
            .Select(g => new { Priority = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Priority, x => x.Count, ct);

        var workloads = await GetProjectManagerWorkloadsAsync(ct);
        var recentActivities = await GetRecentActivityAsync(10, ct);

        var stats = new DashboardStatsDto(
            TotalProjects: totalProjects,
            ActiveProjects: activeProjects,
            CompletedProjects: completedProjects,
            ArchivedProjects: archivedProjects,
            OverdueProjects: overdueProjects,
            ProjectsThisMonth: projectsThisMonth,
            ProjectsByStatus: projectsByStatus,
            ProjectsByPriority: projectsByPriority,
            ProjectManagerWorkloads: workloads.Value ?? new List<ProjectManagerWorkloadDto>(),
            RecentActivities: recentActivities.Value ?? new List<RecentActivityDto>()
        );

        return Result<DashboardStatsDto>.Ok(stats);
    }

    /// <inheritdoc />
    public async Task<Result<Dictionary<string, int>>> GetProjectsByStatusAsync(CancellationToken ct = default)
    {
        var result = await _db.Projects
            .GroupBy(p => p.Status.ToString())
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, ct);

        return Result<Dictionary<string, int>>.Ok(result);
    }

    /// <inheritdoc />
    public async Task<Result<List<ProjectManagerWorkloadDto>>> GetProjectManagerWorkloadsAsync(CancellationToken ct = default)
    {
        var managers = await _db.AppUsers
            .Where(u => u.Role == UserRole.ProjectManager && u.IsActive)
            .ToListAsync(ct);

        var workloads = new List<ProjectManagerWorkloadDto>();

        foreach (var manager in managers)
        {
            var projects = await _db.Projects
                .Where(p => p.ProjectManagerId == manager.Id)
                .ToListAsync(ct);

            var now = DateTime.UtcNow;
            workloads.Add(new ProjectManagerWorkloadDto(
                ManagerId: manager.Id,
                ManagerName: $"{manager.FirstName} {manager.LastName}",
                ManagerEmail: manager.Email,
                TotalProjects: projects.Count,
                InProgressProjects: projects.Count(p => p.Status == ProjectStatus.InProgress),
                CompletedProjects: projects.Count(p => p.Status == ProjectStatus.Completed),
                OverdueProjects: projects.Count(p => p.EndDate < now && p.Status != ProjectStatus.Completed && p.Status != ProjectStatus.Archived)
            ));
        }

        return Result<List<ProjectManagerWorkloadDto>>.Ok(workloads);
    }

    /// <inheritdoc />
    public async Task<Result<List<RecentActivityDto>>> GetRecentActivityAsync(int count = 10, CancellationToken ct = default)
    {
        var rows = await _db.ProjectActivities
            .AsNoTracking()
            .Include(a => a.User)
            .Include(a => a.Project)
            .OrderByDescending(a => a.CreatedAt)
            .Take(count)
            .ToListAsync(ct);

        var activities = rows.Select(a => new RecentActivityDto(
            a.Id,
            a.Action,
            a.Detail,
            a.CreatedAt,
            a.User != null ? $"{a.User.FirstName} {a.User.LastName}" : null,
            a.Project?.Name
        )).ToList();

        return Result<List<RecentActivityDto>>.Ok(activities);
    }

    /// <inheritdoc />
    public async Task<Result<(int Count, List<ProjectSummaryDto> Projects)>> GetOverdueProjectsAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var query = _db.Projects
            .AsNoTracking()
            .Where(p => p.EndDate < now && p.Status != ProjectStatus.Completed && p.Status != ProjectStatus.Archived)
            .Include(p => p.ProjectManager)
            .OrderByDescending(p => p.EndDate);

        var count = await query.CountAsync(ct);
        var rawProjects = await query.ToListAsync(ct);

        var projects = rawProjects.Select(p => new ProjectSummaryDto(
            p.Id,
            p.Name,
            p.ClientName,
            p.ProjectManager != null ? $"{p.ProjectManager.FirstName} {p.ProjectManager.LastName}" : null,
            p.ProjectManager?.Email,
            p.Status,
            p.StartDate,
            p.EndDate,
            p.CreatedAt
        )).ToList();

        return Result<(int, List<ProjectSummaryDto>)>.Ok((count, projects));
    }
}

