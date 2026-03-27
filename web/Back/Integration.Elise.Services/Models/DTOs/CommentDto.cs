/**
 * @file     CommentDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for project comments
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>A comment on a project.</summary>
public record ProjectCommentDto(
    Guid Id,
    Guid ProjectId,
    Guid UserId,
    string UserName,
    string? UserAvatarPath,
    string Content,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    Guid? ParentCommentId,
    List<ProjectCommentDto> Replies,
    List<string> Mentions
);

/// <summary>Request to create a new comment.</summary>
public record CreateCommentDto(
    string Content,
    Guid? ParentCommentId = null
);

/// <summary>Request to update an existing comment.</summary>
public record UpdateCommentDto(
    string Content
);
