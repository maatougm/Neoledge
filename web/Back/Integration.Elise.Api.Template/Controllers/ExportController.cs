/**
 * @file     ExportController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for exporting project data (CSV, JSON)
 */

using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Provides project data export in CSV and JSON formats.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,ProjectManager")]
[Route("api/[controller]")]
public class ExportController : ControllerBase
{
    private readonly IExportService _exportService;
    private readonly Serilog.ILogger _logger;

    public ExportController(IExportService exportService, Serilog.ILogger logger)
    {
        _exportService = exportService;
        _logger        = logger;
    }

    /// <summary>
    /// Exports projects to CSV. Returns the file directly for download.
    /// Pass project IDs in query string as repeated <c>ids</c> params, or omit to export all.
    /// </summary>
    [HttpGet("projects/csv")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ExportProjectsCsv(
        [FromQuery] List<Guid> ids, CancellationToken ct)
    {
        var result = await _exportService.ExportToCsvAsync(ids ?? new List<Guid>(), ct);
        if (result.IsFailure) return BadRequest(new { error = result.Error });

        var fileName = $"projets_{DateTime.UtcNow:yyyyMMdd}.csv";
        return File(result.Value!, "text/csv; charset=utf-8", fileName);
    }

    /// <summary>
    /// Exports projects to JSON. Returns the file directly for download.
    /// </summary>
    [HttpGet("projects/json")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ExportProjectsJson(
        [FromQuery] List<Guid> ids, CancellationToken ct)
    {
        var request = new ExportProjectsRequestDto(
            ids ?? new List<Guid>(),
            ExportFormat.Json);

        var result = await _exportService.ExportProjectsAsync(request, ct);
        if (result.IsFailure) return BadRequest(new { error = result.Error });

        return Ok(result.Value);
    }

    /// <summary>
    /// Generates a plain-text report for a single project.
    /// </summary>
    [HttpGet("projects/{projectId:guid}/report")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GenerateReport(Guid projectId, CancellationToken ct)
    {
        var result = await _exportService.GenerateProjectReportAsync(projectId, ct);
        if (result.IsFailure) return NotFound(new { error = result.Error });
        return Ok(result.Value);
    }
}
