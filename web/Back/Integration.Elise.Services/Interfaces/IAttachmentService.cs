/**
 * @file     IAttachmentService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for project file attachments
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Manages file attachments for projects.
/// </summary>
public interface IAttachmentService
{
    /// <summary>Gets all attachments for a project.</summary>
    Task<Result<List<ProjectAttachmentDto>>> GetProjectAttachmentsAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Gets a single attachment by ID.</summary>
    Task<Result<ProjectAttachmentDto>> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default);

    /// <summary>Uploads a new attachment to a project.</summary>
    Task<Result<ProjectAttachmentDto>> UploadAttachmentAsync(Guid projectId, Guid userId, UploadAttachmentDto dto, CancellationToken ct = default);

    /// <summary>Updates attachment metadata.</summary>
    Task<Result<ProjectAttachmentDto>> UpdateAttachmentAsync(Guid attachmentId, UpdateAttachmentDto dto, CancellationToken ct = default);

    /// <summary>Soft-deletes an attachment.</summary>
    Task<Result> DeleteAttachmentAsync(Guid attachmentId, CancellationToken ct = default);

    /// <summary>Gets the file content for download.</summary>
    Task<Result<(byte[] Content, string FileName, string ContentType)>> DownloadAttachmentAsync(Guid attachmentId, CancellationToken ct = default);

    /// <summary>Gets total storage used by attachments.</summary>
    Task<Result<long>> GetTotalStorageUsedAsync(CancellationToken ct = default);
}
