/**
 * @file     ICommentService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for project comments
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Manages comments on projects for team discussion.
/// </summary>
public interface ICommentService
{
    /// <summary>Gets all comments for a project.</summary>
    Task<Result<List<ProjectCommentDto>>> GetProjectCommentsAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Gets a single comment by ID.</summary>
    Task<Result<ProjectCommentDto>> GetCommentByIdAsync(Guid commentId, CancellationToken ct = default);

    /// <summary>Creates a new comment on a project.</summary>
    Task<Result<ProjectCommentDto>> CreateCommentAsync(Guid projectId, Guid userId, CreateCommentDto dto, CancellationToken ct = default);

    /// <summary>Updates an existing comment (only by the author or admin).</summary>
    Task<Result<ProjectCommentDto>> UpdateCommentAsync(Guid commentId, Guid userId, bool isAdmin, UpdateCommentDto dto, CancellationToken ct = default);

    /// <summary>Soft-deletes a comment (only by the author or admin).</summary>
    Task<Result> DeleteCommentAsync(Guid commentId, Guid userId, bool isAdmin, CancellationToken ct = default);

    /// <summary>Adds a reply to an existing comment.</summary>
    Task<Result<ProjectCommentDto>> AddReplyAsync(Guid parentCommentId, Guid userId, CreateCommentDto dto, CancellationToken ct = default);
}
