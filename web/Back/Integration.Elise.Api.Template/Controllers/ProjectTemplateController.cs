/**
 * @file     ProjectTemplateController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for project template management
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages project templates — admins can create reusable field sets and apply them to any project.
/// All endpoints require a valid JWT.
/// </summary>
[ApiController]
[Authorize]
[Route("admin/projecttemplate")]
public class ProjectTemplateController : ControllerBase
{
    private readonly IProjectTemplateService _templateService;
    private readonly Serilog.ILogger _logger;

    public ProjectTemplateController(IProjectTemplateService templateService, Serilog.ILogger logger)
    {
        _templateService = templateService;
        _logger          = logger;
    }

    private Guid CurrentAdminId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    /// <summary>Returns all templates (summary list).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IEnumerable<ProjectTemplateSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var result = await _templateService.GetAllAsync(ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Returns full detail of a single template including its field definitions.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(ProjectTemplateDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await _templateService.GetByIdAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Creates a new project template with field definitions.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ProjectTemplateDetailDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateProjectTemplateDto dto, CancellationToken ct)
    {
        var result = await _templateService.CreateAsync(dto, CurrentAdminId, ct);
        if (result.IsFailure)
        {
            _logger.Warning("CreateTemplate failed: {Error}", result.Error);
            return BadRequest(new { error = result.Error });
        }
        return CreatedAtAction(nameof(GetById), new { id = result.Value!.Id }, result.Value);
    }

    /// <summary>Deletes a template and all its field definitions.</summary>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var result = await _templateService.DeleteAsync(id, ct);
        return result.IsSuccess ? NoContent() : NotFound(new { error = result.Error });
    }

    /// <summary>Applies a template's Custom fields to a project.</summary>
    [HttpPost("{id:guid}/apply/{projectId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Apply(Guid id, Guid projectId, CancellationToken ct)
    {
        var result = await _templateService.ApplyToProjectAsync(id, projectId, ct);
        if (result.IsFailure)
        {
            _logger.Warning("ApplyTemplate {TemplateId} to project {ProjectId} failed: {Error}", id, projectId, result.Error);
            return result.Error!.Contains("introuvable")
                ? NotFound(new { error = result.Error })
                : BadRequest(new { error = result.Error });
        }
        return NoContent();
    }
}
