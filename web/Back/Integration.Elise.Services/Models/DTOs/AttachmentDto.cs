/**
 * @file     AttachmentDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for project attachments
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>A file attachment for a project.</summary>
public record ProjectAttachmentDto(
    Guid Id,
    Guid ProjectId,
    Guid UploadedByUserId,
    string UploadedByUserName,
    string FileName,
    string FileExtension,
    string ContentType,
    long FileSize,
    string FileSizeFormatted,
    string? Description,
    string Category,
    DateTime UploadedAt,
    string DownloadUrl
);

/// <summary>Request to upload a new attachment.</summary>
public record UploadAttachmentDto(
    string FileName,
    string ContentType,
    long FileSize,
    string Base64Content,
    string? Description = null,
    string Category = "Document"
);

/// <summary>Request to update attachment metadata.</summary>
public record UpdateAttachmentDto(
    string? Description,
    string? Category
);
