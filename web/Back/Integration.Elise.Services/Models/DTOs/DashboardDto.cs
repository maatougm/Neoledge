/**
 * @file     DashboardDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for dashboard statistics and metrics
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>Dashboard statistics for admin overview.</summary>
public record DashboardStatsDto(
    int TotalProjects,
    int ActiveProjects,
    int CompletedProjects,
    int ArchivedProjects,
    int OverdueProjects,
    int ProjectsThisMonth,
    Dictionary<string, int> ProjectsByStatus,
    Dictionary<string, int> ProjectsByPriority,
    List<ProjectManagerWorkloadDto> ProjectManagerWorkloads,
    List<RecentActivityDto> RecentActivities
);

/// <summary>Workload stats for a project manager.</summary>
public record ProjectManagerWorkloadDto(
    Guid ManagerId,
    string ManagerName,
    string ManagerEmail,
    int TotalProjects,
    int InProgressProjects,
    int CompletedProjects,
    int OverdueProjects
);

/// <summary>Recent activity summary for dashboard.</summary>
public record RecentActivityDto(
    Guid Id,
    string Action,
    string? Detail,
    DateTime Timestamp,
    string? UserName,
    string? ProjectName
);

/// <summary>Search and filter parameters for projects.</summary>
public class ProjectSearchFilterDto
{
    public string? SearchTerm { get; set; }
    public string? Status { get; set; }
    public string? Priority { get; set; }
    public Guid? ProjectManagerId { get; set; }
    public DateTime? StartDateFrom { get; set; }
    public DateTime? StartDateTo { get; set; }
    public DateTime? EndDateFrom { get; set; }
    public DateTime? EndDateTo { get; set; }
    public string? SortBy { get; set; } = "CreatedAt";
    public bool SortDescending { get; set; } = true;
    public int PageNumber { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

/// <summary>Search result with pagination.</summary>
public record PagedResultDto<T>(
    List<T> Items,
    int TotalCount,
    int PageNumber,
    int PageSize,
    int TotalPages
);
