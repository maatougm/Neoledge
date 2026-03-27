/**
 * @file     IDashboardService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for dashboard statistics and metrics
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Provides aggregated dashboard statistics and metrics.
/// </summary>
public interface IDashboardService
{
    /// <summary>Gets comprehensive dashboard statistics for admin overview.</summary>
    Task<Result<DashboardStatsDto>> GetDashboardStatsAsync(CancellationToken ct = default);

    /// <summary>Gets project counts grouped by status.</summary>
    Task<Result<Dictionary<string, int>>> GetProjectsByStatusAsync(CancellationToken ct = default);

    /// <summary>Gets workload statistics for all project managers.</summary>
    Task<Result<List<ProjectManagerWorkloadDto>>> GetProjectManagerWorkloadsAsync(CancellationToken ct = default);

    /// <summary>Gets recent activity feed for dashboard.</summary>
    Task<Result<List<RecentActivityDto>>> GetRecentActivityAsync(int count = 10, CancellationToken ct = default);

    /// <summary>Gets overdue projects count and list.</summary>
    Task<Result<(int Count, List<ProjectSummaryDto> Projects)>> GetOverdueProjectsAsync(CancellationToken ct = default);
}
