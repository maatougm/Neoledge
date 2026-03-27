/**
 * @file     ProjectComment.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Comments/notes on projects for team discussion
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>A comment on a project for team discussion and collaboration.</summary>
public class ProjectComment
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the project this comment belongs to.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>FK to the user who wrote this comment.</summary>
    public Guid UserId { get; set; }

    /// <summary>The comment text content.</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>UTC timestamp when the comment was created.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>UTC timestamp when the comment was last edited. Null if never edited.</summary>
    public DateTime? UpdatedAt { get; set; }

    /// <summary>When true, the comment is soft-deleted.</summary>
    public bool IsDeleted { get; set; } = false;

    /// <summary>Parent comment ID for threaded replies. Null for top-level comments.</summary>
    public Guid? ParentCommentId { get; set; }

    /// <summary>List of mentioned user IDs (JSON array).</summary>
    public string? Mentions { get; set; }

    // Navigation properties
    /// <summary>The project this comment belongs to.</summary>
    public Project? Project { get; set; }

    /// <summary>The user who wrote this comment.</summary>
    public AppUser? User { get; set; }

    /// <summary>Parent comment for threaded replies.</summary>
    public ProjectComment? ParentComment { get; set; }

    /// <summary>Child replies to this comment.</summary>
    public ICollection<ProjectComment> Replies { get; set; } = new List<ProjectComment>();
}
