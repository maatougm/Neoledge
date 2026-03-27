/**
 * @file     SystemStatusController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     System health/statistics endpoint for the admin dashboard
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Models.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Api.Controllers;

[ApiController]
[Authorize]
[Route("admin/[controller]")]
public class SystemStatusController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public SystemStatusController(ApplicationDbContext db)
    {
        _db = db;
    }

    /// <summary>Returns aggregate counts used by the system status dashboard.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(SystemStatusDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStatus(CancellationToken ct)
    {
        var userTotal  = await _db.AppUsers.CountAsync(ct);
        var userActive = await _db.AppUsers.CountAsync(u => u.IsActive, ct);

        var projectCounts = await _db.Projects
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Status.ToString(), g => g.Count, ct);

        var totalProjects = projectCounts.Values.Sum();

        return Ok(new SystemStatusDto(
            DatabaseStatus:  "OK",
            UserTotal:       userTotal,
            UserActive:      userActive,
            ProjectTotal:    totalProjects,
            ProjectByStatus: projectCounts
        ));
    }

    public record SystemStatusDto(
        string DatabaseStatus,
        int    UserTotal,
        int    UserActive,
        int    ProjectTotal,
        Dictionary<string, int> ProjectByStatus
    );
}
