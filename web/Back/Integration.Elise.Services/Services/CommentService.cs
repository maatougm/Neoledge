/**
 * @file     CommentService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Project comments service
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Services;

/// <inheritdoc />
public class CommentService : ICommentService
{
    private readonly ApplicationDbContext _db;

    public CommentService(ApplicationDbContext db)
    {
        _db = db;
    }

    /// <inheritdoc />
    public async Task<Result<List<ProjectCommentDto>>> GetProjectCommentsAsync(Guid projectId, CancellationToken ct = default)
    {
        var comments = await _db.ProjectComments
            .AsNoTracking()
            .Include(c => c.User)
            .Where(c => c.ProjectId == projectId && c.ParentCommentId == null)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

        var result = new List<ProjectCommentDto>();
        foreach (var comment in comments)
        {
            result.Add(await MapToDtoAsync(comment, ct));
        }

        return Result<List<ProjectCommentDto>>.Ok(result);
    }

    /// <inheritdoc />
    public async Task<Result<ProjectCommentDto>> GetCommentByIdAsync(Guid commentId, CancellationToken ct = default)
    {
        var comment = await _db.ProjectComments
            .AsNoTracking()
            .Include(c => c.User)
            .FirstOrDefaultAsync(c => c.Id == commentId, ct);

        if (comment == null)
            return Result<ProjectCommentDto>.Fail("Comment not found");

        return Result<ProjectCommentDto>.Ok(await MapToDtoAsync(comment, ct));
    }

    /// <inheritdoc />
    public async Task<Result<ProjectCommentDto>> CreateCommentAsync(Guid projectId, Guid userId, CreateCommentDto dto, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { projectId }, ct);
        if (project == null)
            return Result<ProjectCommentDto>.Fail("Project not found");

        var mentions = ExtractMentions(dto.Content);

        var comment = new ProjectComment
        {
            ProjectId = projectId,
            UserId = userId,
            Content = dto.Content,
            ParentCommentId = dto.ParentCommentId,
            Mentions = mentions.Count > 0 ? System.Text.Json.JsonSerializer.Serialize(mentions) : null
        };

        _db.ProjectComments.Add(comment);
        await _db.SaveChangesAsync(ct);

        // Reload with user info
        await _db.Entry(comment).Reference(c => c.User).LoadAsync(ct);

        return Result<ProjectCommentDto>.Ok(await MapToDtoAsync(comment, ct));
    }

    /// <inheritdoc />
    public async Task<Result<ProjectCommentDto>> UpdateCommentAsync(Guid commentId, Guid userId, UpdateCommentDto dto, CancellationToken ct = default)
    {
        var comment = await _db.ProjectComments.FindAsync(new object[] { commentId }, ct);
        if (comment == null)
            return Result<ProjectCommentDto>.Fail("Comment not found");

        if (comment.UserId != userId)
            return Result<ProjectCommentDto>.Fail("You can only edit your own comments");

        comment.Content = dto.Content;
        comment.UpdatedAt = DateTime.UtcNow;

        var mentions = ExtractMentions(dto.Content);
        comment.Mentions = mentions.Count > 0 ? System.Text.Json.JsonSerializer.Serialize(mentions) : null;

        await _db.SaveChangesAsync(ct);

        // Reload with user info
        await _db.Entry(comment).Reference(c => c.User).LoadAsync(ct);

        return Result<ProjectCommentDto>.Ok(await MapToDtoAsync(comment, ct));
    }

    /// <inheritdoc />
    public async Task<Result> DeleteCommentAsync(Guid commentId, Guid userId, bool isAdmin, CancellationToken ct = default)
    {
        var comment = await _db.ProjectComments.FindAsync(new object[] { commentId }, ct);
        if (comment == null)
            return Result.Fail("Comment not found");

        if (comment.UserId != userId && !isAdmin)
            return Result.Fail("You can only delete your own comments");

        comment.IsDeleted = true;
        await _db.SaveChangesAsync(ct);

        return Result.Ok();
    }

    /// <inheritdoc />
    public async Task<Result<ProjectCommentDto>> AddReplyAsync(Guid parentCommentId, Guid userId, CreateCommentDto dto, CancellationToken ct = default)
    {
        var parentComment = await _db.ProjectComments
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == parentCommentId, ct);

        if (parentComment == null)
            return Result<ProjectCommentDto>.Fail("Parent comment not found");

        return await CreateCommentAsync(parentComment.ProjectId, userId, dto with { ParentCommentId = parentCommentId }, ct);
    }

    private async Task<ProjectCommentDto> MapToDtoAsync(ProjectComment comment, CancellationToken ct)
    {
        var replies = await _db.ProjectComments
            .AsNoTracking()
            .Include(c => c.User)
            .Where(c => c.ParentCommentId == comment.Id && !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);

        var replyDtos = new List<ProjectCommentDto>();
        foreach (var reply in replies)
        {
            replyDtos.Add(await MapToDtoAsync(reply, ct));
        }

        List<string> mentions = new();
        if (!string.IsNullOrEmpty(comment.Mentions))
        {
            try
            {
                mentions = System.Text.Json.JsonSerializer.Deserialize<List<string>>(comment.Mentions) ?? new List<string>();
            }
            catch { }
        }

        return new ProjectCommentDto(
            Id: comment.Id,
            ProjectId: comment.ProjectId,
            UserId: comment.UserId,
            UserName: comment.User != null ? $"{comment.User.FirstName} {comment.User.LastName}" : "Unknown",
            UserAvatarPath: comment.User?.AvatarPath,
            Content: comment.Content,
            CreatedAt: comment.CreatedAt,
            UpdatedAt: comment.UpdatedAt,
            ParentCommentId: comment.ParentCommentId,
            Replies: replyDtos,
            Mentions: mentions
        );
    }

    private static List<string> ExtractMentions(string content)
    {
        var mentions = new List<string>();
        if (string.IsNullOrEmpty(content))
            return mentions;

        // Simple @mention extraction
        var parts = content.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        foreach (var part in parts)
        {
            if (part.StartsWith("@") && part.Length > 1)
            {
                mentions.Add(part[1..].TrimEnd(',', '.', '!', '?'));
            }
        }

        return mentions;
    }
}

