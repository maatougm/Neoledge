/**
 * @file     ProjectController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     REST endpoints for project lifecycle management
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages deployment projects.
/// All endpoints require a valid JWT.
/// </summary>
[ApiController]
[Authorize]
[Route("admin/[controller]")]
public class ProjectController : ControllerBase
{
    private readonly IProjectService _projectService;
    private readonly Serilog.ILogger _logger;

    public ProjectController(IProjectService projectService, Serilog.ILogger logger)
    {
        _projectService = projectService;
        _logger         = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    /// <summary>Returns all projects (summary).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IEnumerable<ProjectSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var result = await _projectService.GetAllProjectsAsync(ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Returns a single project with full detail.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(ProjectDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await _projectService.GetProjectByIdAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(result.Error);
    }

    /// <summary>Returns all projects assigned to a specific project manager.</summary>
    [HttpGet("manager/{managerId:guid}")]
    [ProducesResponseType(typeof(IEnumerable<ProjectSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetByManager(Guid managerId, CancellationToken ct)
    {
        var result = await _projectService.GetMyProjectsAsync(managerId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Returns all projects with the given status.</summary>
    [HttpGet("by-status/{status}")]
    [ProducesResponseType(typeof(IEnumerable<ProjectSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetByStatus(ProjectStatus status, CancellationToken ct)
    {
        var result = await _projectService.GetProjectsByStatusAsync(status, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Creates a new project with auto-seeded static fields.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ProjectDetailDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateProjectDto dto, CancellationToken ct)
    {
        var result = await _projectService.CreateProjectAsync(CurrentUserId, dto, ct);
        if (result.IsFailure)
        {
            _logger.Warning("CreateProject failed: {Error}", result.Error);
            return BadRequest(result.Error);
        }
        return CreatedAtAction(nameof(GetById), new { id = result.Value!.Id }, result.Value);
    }

    /// <summary>Updates mutable metadata of an existing project.</summary>
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(ProjectDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateProjectDto dto, CancellationToken ct)
    {
        var result = await _projectService.UpdateProjectAsync(id, dto, ct);
        return result.IsSuccess ? Ok(result.Value) : result.Error!.Contains("introuvable")
            ? NotFound(result.Error) : BadRequest(result.Error);
    }

    /// <summary>Soft-deletes a project (marks as deleted, preserves data).</summary>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var result = await _projectService.SoftDeleteProjectAsync(id, CurrentUserId, ct);
        return result.IsSuccess ? NoContent() : NotFound(result.Error);
    }

    /// <summary>Assigns a project manager to a project.</summary>
    [HttpPost("{id:guid}/assign-manager")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AssignManager(Guid id, [FromBody] AssignProjectManagerDto dto, CancellationToken ct)
    {
        var result = await _projectService.AssignProjectManagerAsync(id, dto.ProjectManagerId, ct);
        return result.IsSuccess ? NoContent() : BadRequest(result.Error);
    }

    /// <summary>Updates the lifecycle status of a project.</summary>
    [HttpPost("{id:guid}/status")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest request, CancellationToken ct)
    {
        var result = await _projectService.UpdateProjectStatusAsync(id, request.Status, ct);
        return result.IsSuccess ? NoContent() : BadRequest(result.Error);
    }

    /// <summary>Archives a project (sets status to Archived).</summary>
    [HttpPatch("{id:guid}/archive")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Archive(Guid id, CancellationToken ct)
    {
        var result = await _projectService.ArchiveProjectAsync(id, ct);
        return result.IsSuccess ? NoContent() : NotFound(result.Error);
    }

    /// <summary>Adds a custom field to the project questionnaire.</summary>
    [HttpPost("{id:guid}/fields")]
    [ProducesResponseType(typeof(object), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> AddField(Guid id, [FromBody] AddProjectFieldDto dto, CancellationToken ct)
    {
        var result = await _projectService.AddCustomFieldAsync(id, dto, ct);
        return result.IsSuccess
            ? CreatedAtAction(nameof(GetById), new { id }, result.Value)
            : BadRequest(result.Error);
    }

    /// <summary>Removes a field from the project questionnaire.</summary>
    [HttpDelete("{id:guid}/fields/{fieldId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> RemoveField(Guid id, Guid fieldId, CancellationToken ct)
    {
        var result = await _projectService.RemoveFieldAsync(id, fieldId, ct);
        return result.IsSuccess ? NoContent() : BadRequest(result.Error);
    }

    /// <summary>Grants or revokes the project manager's permission to add custom fields.</summary>
    [HttpPatch("{id:guid}/toggle-manager-fields")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ToggleManagerFields(Guid id, [FromBody] ToggleManagerFieldsRequest request, CancellationToken ct)
    {
        var result = await _projectService.ToggleManagerFieldsAsync(id, request.Allow, ct);
        return result.IsSuccess ? NoContent() : NotFound(result.Error);
    }

    // ── Feature 2: Project Duplication ────────────────────────────────────────

    /// <summary>Duplicates an existing project under a new name, copying only Static field values.</summary>
    [HttpPost("{id:guid}/duplicate")]
    [ProducesResponseType(typeof(ProjectDetailDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Duplicate(Guid id, [FromBody] DuplicateProjectDto dto, CancellationToken ct)
    {
        var result = await _projectService.DuplicateProjectAsync(id, dto.Name, ct);
        if (result.IsFailure)
        {
            _logger.Warning("DuplicateProject {Id} failed: {Error}", id, result.Error);
            return result.Error!.Contains("introuvable")
                ? NotFound(new { error = result.Error })
                : BadRequest(new { error = result.Error });
        }
        return CreatedAtAction(nameof(GetById), new { id = result.Value!.Id }, result.Value);
    }

    // ── Feature 3: Bulk Operations ────────────────────────────────────────────

    /// <summary>Archives multiple projects in a single request.</summary>
    [HttpPost("bulk-archive")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkArchive([FromBody] BulkProjectIdsDto dto, CancellationToken ct)
    {
        var result = await _projectService.BulkArchiveAsync(dto.ProjectIds, ct);
        return result.IsSuccess ? NoContent() : BadRequest(new { error = result.Error });
    }

    /// <summary>Transitions multiple projects to the specified status, skipping those blocked by phase gates.</summary>
    [HttpPost("bulk-status")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkStatus([FromBody] BulkStatusDto dto, CancellationToken ct)
    {
        var result = await _projectService.BulkUpdateStatusAsync(dto.ProjectIds, dto.Status, ct);
        return result.IsSuccess ? NoContent() : BadRequest(new { error = result.Error });
    }

    /// <summary>Assigns a project manager to multiple projects in a single request.</summary>
    [HttpPost("bulk-assign-manager")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkAssignManager([FromBody] BulkAssignManagerDto dto, CancellationToken ct)
    {
        var result = await _projectService.BulkAssignManagerAsync(dto.ProjectIds, dto.ManagerId, ct);
        return result.IsSuccess ? NoContent() : BadRequest(new { error = result.Error });
    }

    // ── Feature 4: Activity Feed ──────────────────────────────────────────────

    /// <summary>Returns the activity feed for a project.</summary>
    [HttpGet("{id:guid}/activity")]
    [ProducesResponseType(typeof(IEnumerable<ProjectActivityDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetActivity(Guid id, CancellationToken ct)
    {
        var result = await _projectService.GetActivityAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Request body for status updates.</summary>
    public record UpdateStatusRequest(ProjectStatus Status);

    /// <summary>Request body for toggling manager field permissions.</summary>
    public record ToggleManagerFieldsRequest(bool Allow);
}
