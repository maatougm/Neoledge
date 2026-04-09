/**
 * @file     ProjectManagerController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for project manager operations — questionnaire, custom fields, validations
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Models.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Endpoints for project managers — questionnaire saves, custom field management,
/// and team validation submissions.
/// All endpoints require a valid JWT.
/// </summary>
[ApiController]
[Authorize]
[Route("pm")]
public class ProjectManagerController : ControllerBase
{
    private readonly IProjectService _projectService;
    private readonly IProjectValidationRepository _validationRepo;
    private readonly IProjectRepository _projectRepo;
    private readonly Serilog.ILogger _logger;

    public ProjectManagerController(
        IProjectService projectService,
        IProjectValidationRepository validationRepo,
        IProjectRepository projectRepo,
        Serilog.ILogger logger)
    {
        _projectService = projectService;
        _validationRepo = validationRepo;
        _projectRepo    = projectRepo;
        _logger         = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    private string CurrentUserRole =>
        User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    /// <summary>Returns all projects assigned to the current PM.</summary>
    [HttpGet("projects")]
    [ProducesResponseType(typeof(IEnumerable<ProjectSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetMyProjects(CancellationToken ct)
    {
        var result = await _projectService.GetMyProjectsAsync(CurrentUserId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Returns full detail of a single project.</summary>
    [HttpGet("projects/{id:guid}")]
    [ProducesResponseType(typeof(ProjectDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetProject(Guid id, CancellationToken ct)
    {
        var result = await _projectService.GetProjectByIdAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(result.Error);
    }

    /// <summary>Saves questionnaire field values for a project.</summary>
    [HttpPatch("projects/{id:guid}/field-values")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SaveFieldValues(Guid id, [FromBody] SaveQuestionnaireDto dto, CancellationToken ct)
    {
        var project = await _projectService.GetProjectByIdAsync(id, ct);
        if (!project.IsSuccess) return NotFound(project.Error);

        if (project.Value!.ProjectManager?.Id != CurrentUserId)
            return Forbid();

        var pairs = dto.FieldValues.Select(fv => (fv.ProjectFieldId, fv.Value));
        await _projectRepo.SaveFieldValuesAsync(id, pairs, ct);
        _logger.Information("PM {UserId} saved questionnaire for project {ProjectId}", CurrentUserId, id);
        return NoContent();
    }

    /// <summary>Adds a custom field (requires AllowManagerCustomFields = true).</summary>
    [HttpPost("projects/{id:guid}/fields")]
    [ProducesResponseType(typeof(ProjectFieldDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AddField(Guid id, [FromBody] AddProjectFieldDto dto, CancellationToken ct)
    {
        var project = await _projectService.GetProjectByIdAsync(id, ct);
        if (!project.IsSuccess) return NotFound(project.Error);

        if (project.Value!.ProjectManager?.Id != CurrentUserId)
            return Forbid();

        if (!project.Value.AllowManagerCustomFields)
            return Forbid();

        var result = await _projectService.AddCustomFieldAsync(id, dto, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(result.Error);
    }

    /// <summary>Returns all team validations for a project.</summary>
    [HttpGet("projects/{id:guid}/validations")]
    [ProducesResponseType(typeof(IEnumerable<ProjectValidationDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetValidations(Guid id, CancellationToken ct)
    {
        var validations = await _validationRepo.GetByProjectIdAsync(id, ct);
        var dtos = validations.Select(v => new ProjectValidationDto(
            v.Id,
            v.ProjectId,
            v.ValidatedByRole,
            v.ValidatedBy != null ? $"{v.ValidatedBy.FirstName} {v.ValidatedBy.LastName}" : "—",
            v.Phase,
            v.IsApproved,
            v.Comment,
            v.ValidatedAt
        ));
        return Ok(dtos);
    }

    /// <summary>Returns the activity feed for a project assigned to the current PM.</summary>
    [HttpGet("projects/{id:guid}/activity")]
    [ProducesResponseType(typeof(IEnumerable<ProjectActivityDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetActivity(Guid id, CancellationToken ct)
    {
        var project = await _projectService.GetProjectByIdAsync(id, ct);
        if (!project.IsSuccess) return NotFound(project.Error);

        if (project.Value!.ProjectManager?.Id != CurrentUserId)
            return Forbid();

        var result = await _projectService.GetActivityAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Submits a validation from the current user's team.</summary>
    [HttpPost("projects/{id:guid}/validations")]
    [ProducesResponseType(typeof(ProjectValidationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SubmitValidation(Guid id, [FromBody] SubmitValidationDto dto, CancellationToken ct)
    {
        var project = await _projectService.GetProjectByIdAsync(id, ct);
        if (!project.IsSuccess) return NotFound(project.Error);

        var validation = new ProjectValidation
        {
            ProjectId         = id,
            ValidatedByUserId = CurrentUserId,
            ValidatedByRole   = CurrentUserRole,
            Phase             = project.Value!.Status,
            IsApproved        = dto.IsApproved,
            Comment           = dto.Comment
        };

        await _validationRepo.AddAsync(validation, ct);
        _logger.Information("User {UserId} submitted validation for project {ProjectId}", CurrentUserId, id);

        return Ok(new ProjectValidationDto(
            validation.Id,
            validation.ProjectId,
            validation.ValidatedByRole,
            "—",
            validation.Phase,
            validation.IsApproved,
            validation.Comment,
            validation.ValidatedAt
        ));
    }
}
