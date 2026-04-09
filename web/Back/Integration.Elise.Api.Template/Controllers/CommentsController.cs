/**
 * @file     CommentsController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     REST endpoints for project comments
 */

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages comments on projects for team discussion.
/// </summary>
[ApiController]
[Authorize]
[Route("api/projects/{projectId:guid}/[controller]")]
public class CommentsController : ControllerBase
{
    private readonly ICommentService _commentService;
    private readonly Serilog.ILogger _logger;

    public CommentsController(ICommentService commentService, Serilog.ILogger logger)
    {
        _commentService = commentService;
        _logger = logger;
    }

    private Guid CurrentUserId =>
        Guid.Parse(User.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new UnauthorizedAccessException());

    private bool IsAdmin => User.IsInRole("Admin");

    /// <summary>Gets all comments for a project.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IEnumerable<ProjectCommentDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetComments(Guid projectId, CancellationToken ct)
    {
        var result = await _commentService.GetProjectCommentsAsync(projectId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Creates a new comment on a project.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ProjectCommentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateComment(Guid projectId, [FromBody] CreateCommentDto dto, CancellationToken ct)
    {
        var result = await _commentService.CreateCommentAsync(projectId, CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return CreatedAtAction(nameof(GetComment), new { projectId, commentId = result.Value!.Id }, result.Value);
    }

    /// <summary>Gets a single comment by ID.</summary>
    [HttpGet("{commentId:guid}")]
    [ProducesResponseType(typeof(ProjectCommentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetComment(Guid projectId, Guid commentId, CancellationToken ct)
    {
        var result = await _commentService.GetCommentByIdAsync(commentId, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Updates an existing comment.</summary>
    [HttpPut("{commentId:guid}")]
    [ProducesResponseType(typeof(ProjectCommentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateComment(Guid projectId, Guid commentId, [FromBody] UpdateCommentDto dto, CancellationToken ct)
    {
        var result = await _commentService.UpdateCommentAsync(commentId, CurrentUserId, IsAdmin, dto, ct);
        if (!result.IsSuccess)
        {
            if (result.Error?.Contains("not found") == true)
                return NotFound(new { error = result.Error });
            return BadRequest(new { error = result.Error });
        }

        return Ok(result.Value);
    }

    /// <summary>Soft-deletes a comment.</summary>
    [HttpDelete("{commentId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteComment(Guid projectId, Guid commentId, CancellationToken ct)
    {
        var result = await _commentService.DeleteCommentAsync(commentId, CurrentUserId, IsAdmin, ct);
        if (!result.IsSuccess)
        {
            if (result.Error?.Contains("not found") == true)
                return NotFound(new { error = result.Error });
            return BadRequest(new { error = result.Error });
        }

        return NoContent();
    }

    /// <summary>Adds a reply to an existing comment.</summary>
    [HttpPost("{commentId:guid}/replies")]
    [ProducesResponseType(typeof(ProjectCommentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> AddReply(Guid projectId, Guid commentId, [FromBody] CreateCommentDto dto, CancellationToken ct)
    {
        var result = await _commentService.AddReplyAsync(commentId, CurrentUserId, dto, ct);
        if (!result.IsSuccess)
            return BadRequest(new { error = result.Error });

        return CreatedAtAction(nameof(GetComment), new { projectId, commentId = result.Value!.Id }, result.Value);
    }
}
