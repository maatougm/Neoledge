/**
 * @file     ProjectAttachment.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     File attachments for projects (documents, images, etc.)
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>A file attachment linked to a project.</summary>
public class ProjectAttachment
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the project this attachment belongs to.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>FK to the user who uploaded this attachment.</summary>
    public Guid UploadedByUserId { get; set; }

    /// <summary>Original file name.</summary>
    public string FileName { get; set; } = string.Empty;

    /// <summary>File extension (e.g., .pdf, .docx).</summary>
    public string FileExtension { get; set; } = string.Empty;

    /// <summary> MIME content type.</summary>
    public string ContentType { get; set; } = string.Empty;

    /// <summary>File size in bytes.</summary>
    public long FileSize { get; set; }

    /// <summary>Storage path or URL to the file.</summary>
    public string StoragePath { get; set; } = string.Empty;

    /// <summary>Optional description of the attachment.</summary>
    public string? Description { get; set; }

    /// <summary>Category of the attachment.</summary>
    public AttachmentCategory Category { get; set; } = AttachmentCategory.Document;

    /// <summary>UTC timestamp when the attachment was uploaded.</summary>
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When true, the attachment is soft-deleted.</summary>
    public bool IsDeleted { get; set; } = false;

    // Navigation properties
    /// <summary>The project this attachment belongs to.</summary>
    public Project? Project { get; set; }

    /// <summary>The user who uploaded this attachment.</summary>
    public AppUser? UploadedBy { get; set; }
}

/// <summary>Categories for project attachments.</summary>
public enum AttachmentCategory
{
    Document,
    Specification,
    Contract,
    Screenshot,
    Image,
    Report,
    Other
}
