/**
 * @file     DashboardController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for dashboard statistics and metrics
 */

using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Provides dashboard statistics and analytics.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,ProjectManager")]
[Route("api/[controller]")]
public class DashboardController : ControllerBase
{
    private readonly IDashboardService _dashboardService;
    private readonly Serilog.ILogger _logger;

    public DashboardController(IDashboardService dashboardService, Serilog.ILogger logger)
    {
        _dashboardService = dashboardService;
        _logger = logger;
    }

    /// <summary>Gets comprehensive dashboard statistics.</summary>
    [HttpGet("stats")]
    [ProducesResponseType(typeof(DashboardStatsDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStats(CancellationToken ct)
    {
        var result = await _dashboardService.GetDashboardStatsAsync(ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets project counts grouped by status.</summary>
    [HttpGet("projects-by-status")]
    [ProducesResponseType(typeof(Dictionary<string, int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProjectsByStatus(CancellationToken ct)
    {
        var result = await _dashboardService.GetProjectsByStatusAsync(ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets workload statistics for all project managers.</summary>
    [HttpGet("pm-workloads")]
    [ProducesResponseType(typeof(IEnumerable<ProjectManagerWorkloadDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPmWorkloads(CancellationToken ct)
    {
        var result = await _dashboardService.GetProjectManagerWorkloadsAsync(ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets recent activity feed.</summary>
    [HttpGet("recent-activity")]
    [ProducesResponseType(typeof(IEnumerable<RecentActivityDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetRecentActivity([FromQuery] int count = 10, CancellationToken ct = default)
    {
        var result = await _dashboardService.GetRecentActivityAsync(count, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets overdue projects.</summary>
    [HttpGet("overdue-projects")]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOverdueProjects(CancellationToken ct)
    {
        var result = await _dashboardService.GetOverdueProjectsAsync(ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return Ok(new
        {
            count = result.Value.Count,
            projects = result.Value.Projects
        });
    }
}
