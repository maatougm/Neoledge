/**
 * @file     AttachmentController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for project file attachments
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages file attachments for projects.
/// </summary>
[ApiController]
[Authorize]
[Route("api/projects/{projectId:guid}/attachments")]
public class AttachmentController : ControllerBase
{
    private readonly IAttachmentService _attachmentService;
    private readonly Serilog.ILogger _logger;

    public AttachmentController(IAttachmentService attachmentService, Serilog.ILogger logger)
    {
        _attachmentService = attachmentService;
        _logger            = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    /// <summary>Gets all attachments for a project.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProjectAttachmentDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProjectAttachments(Guid projectId, CancellationToken ct)
    {
        var result = await _attachmentService.GetProjectAttachmentsAsync(projectId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets a single attachment by ID.</summary>
    [HttpGet("{attachmentId:guid}")]
    [ProducesResponseType(typeof(ProjectAttachmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetAttachment(Guid projectId, Guid attachmentId, CancellationToken ct)
    {
        var result = await _attachmentService.GetAttachmentByIdAsync(attachmentId, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Uploads a new file attachment (base64-encoded).</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ProjectAttachmentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Upload(Guid projectId, [FromBody] UploadAttachmentDto dto, CancellationToken ct)
    {
        var result = await _attachmentService.UploadAttachmentAsync(projectId, CurrentUserId, dto, ct);
        if (result.IsFailure) return BadRequest(new { error = result.Error });
        return CreatedAtAction(nameof(GetAttachment),
            new { projectId, attachmentId = result.Value!.Id }, result.Value);
    }

    /// <summary>Updates attachment metadata (description, category).</summary>
    [HttpPatch("{attachmentId:guid}")]
    [ProducesResponseType(typeof(ProjectAttachmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(
        Guid projectId, Guid attachmentId, [FromBody] UpdateAttachmentDto dto, CancellationToken ct)
    {
        var result = await _attachmentService.UpdateAttachmentAsync(attachmentId, dto, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Soft-deletes an attachment.</summary>
    [HttpDelete("{attachmentId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid projectId, Guid attachmentId, CancellationToken ct)
    {
        var result = await _attachmentService.DeleteAttachmentAsync(attachmentId, ct);
        return result.IsSuccess ? NoContent() : NotFound(new { error = result.Error });
    }

    /// <summary>Downloads a file attachment.</summary>
    [HttpGet("{attachmentId:guid}/download")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Download(Guid projectId, Guid attachmentId, CancellationToken ct)
    {
        var result = await _attachmentService.DownloadAttachmentAsync(attachmentId, ct);
        if (result.IsFailure) return NotFound(new { error = result.Error });
        var (content, fileName, contentType) = result.Value!;
        return File(content, contentType, fileName);
    }
}

/// <summary>
/// Admin-level attachment stats endpoint.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/attachments")]
public class AttachmentAdminController : ControllerBase
{
    private readonly IAttachmentService _attachmentService;

    public AttachmentAdminController(IAttachmentService attachmentService)
    {
        _attachmentService = attachmentService;
    }

    /// <summary>Gets total storage used by all attachments.</summary>
    [HttpGet("storage")]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStorageUsed(CancellationToken ct)
    {
        var result = await _attachmentService.GetTotalStorageUsedAsync(ct);
        return result.IsSuccess
            ? Ok(new { bytes = result.Value, formatted = FormatBytes(result.Value) })
            : BadRequest(new { error = result.Error });
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} o";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} Ko";
        return $"{bytes / (1024.0 * 1024.0):F1} Mo";
    }
}
