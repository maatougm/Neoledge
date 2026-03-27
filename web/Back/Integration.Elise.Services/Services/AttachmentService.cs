/**
 * @file     AttachmentService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Project file attachment service — upload, download, list, delete
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Integration.Elise.Services.Services;

/// <inheritdoc />
public class AttachmentService : IAttachmentService
{
    private readonly ApplicationDbContext _db;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<AttachmentService> _logger;

    private const long MaxFileSizeBytes = 10 * 1024 * 1024; // 10 MB

    public AttachmentService(
        ApplicationDbContext db,
        IWebHostEnvironment env,
        ILogger<AttachmentService> logger)
    {
        _db     = db;
        _env    = env;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result<List<ProjectAttachmentDto>>> GetProjectAttachmentsAsync(
        Guid projectId, CancellationToken ct = default)
    {
        var attachments = await _db.ProjectAttachments
            .AsNoTracking()
            .Include(a => a.UploadedBy)
            .Where(a => a.ProjectId == projectId)
            .OrderByDescending(a => a.UploadedAt)
            .ToListAsync(ct);

        return Result<List<ProjectAttachmentDto>>.Ok(
            attachments.Select(MapToDto).ToList());
    }

    /// <inheritdoc />
    public async Task<Result<ProjectAttachmentDto>> GetAttachmentByIdAsync(
        Guid attachmentId, CancellationToken ct = default)
    {
        var attachment = await _db.ProjectAttachments
            .AsNoTracking()
            .Include(a => a.UploadedBy)
            .FirstOrDefaultAsync(a => a.Id == attachmentId, ct);

        if (attachment is null)
            return Result<ProjectAttachmentDto>.Fail("Pièce jointe introuvable.");

        return Result<ProjectAttachmentDto>.Ok(MapToDto(attachment));
    }

    /// <inheritdoc />
    public async Task<Result<ProjectAttachmentDto>> UploadAttachmentAsync(
        Guid projectId, Guid userId, UploadAttachmentDto dto, CancellationToken ct = default)
    {
        var project = await _db.Projects.FindAsync(new object[] { projectId }, ct);
        if (project is null)
            return Result<ProjectAttachmentDto>.Fail("Projet introuvable.");

        // Decode and validate base64
        byte[] fileBytes;
        try
        {
            fileBytes = Convert.FromBase64String(dto.Base64Content);
        }
        catch
        {
            return Result<ProjectAttachmentDto>.Fail("Données de fichier invalides.");
        }

        if (fileBytes.Length > MaxFileSizeBytes)
            return Result<ProjectAttachmentDto>.Fail("Le fichier dépasse la taille maximale de 10 Mo.");

        // Persist to disk
        var uploadsDir = Path.Combine(
            _env.WebRootPath ?? _env.ContentRootPath, "uploads", "attachments", projectId.ToString());
        Directory.CreateDirectory(uploadsDir);

        var ext      = Path.GetExtension(dto.FileName);
        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploadsDir, fileName);

        await File.WriteAllBytesAsync(filePath, fileBytes, ct);

        var storagePath = $"/uploads/attachments/{projectId}/{fileName}";

        var attachment = new ProjectAttachment
        {
            ProjectId        = projectId,
            UploadedByUserId = userId,
            FileName         = dto.FileName,
            FileExtension    = ext,
            ContentType      = dto.ContentType,
            FileSize         = fileBytes.Length,
            StoragePath      = storagePath,
            Description      = dto.Description,
            Category         = Enum.TryParse<AttachmentCategory>(dto.Category, out var cat)
                               ? cat : AttachmentCategory.Document,
        };

        _db.ProjectAttachments.Add(attachment);
        await _db.SaveChangesAsync(ct);

        // Reload with uploader info
        await _db.Entry(attachment).Reference(a => a.UploadedBy).LoadAsync(ct);

        _logger.LogInformation("Attachment {AttachmentId} uploaded to project {ProjectId} by user {UserId}",
            attachment.Id, projectId, userId);

        return Result<ProjectAttachmentDto>.Ok(MapToDto(attachment));
    }

    /// <inheritdoc />
    public async Task<Result<ProjectAttachmentDto>> UpdateAttachmentAsync(
        Guid attachmentId, UpdateAttachmentDto dto, CancellationToken ct = default)
    {
        var attachment = await _db.ProjectAttachments
            .Include(a => a.UploadedBy)
            .FirstOrDefaultAsync(a => a.Id == attachmentId, ct);

        if (attachment is null)
            return Result<ProjectAttachmentDto>.Fail("Pièce jointe introuvable.");

        if (dto.Description is not null)
            attachment.Description = dto.Description;

        if (dto.Category is not null && Enum.TryParse<AttachmentCategory>(dto.Category, out var cat))
            attachment.Category = cat;

        await _db.SaveChangesAsync(ct);

        return Result<ProjectAttachmentDto>.Ok(MapToDto(attachment));
    }

    /// <inheritdoc />
    public async Task<Result> DeleteAttachmentAsync(Guid attachmentId, CancellationToken ct = default)
    {
        var attachment = await _db.ProjectAttachments.FindAsync(new object[] { attachmentId }, ct);
        if (attachment is null)
            return Result.Fail("Pièce jointe introuvable.");

        attachment.IsDeleted = true;
        await _db.SaveChangesAsync(ct);

        return Result.Ok();
    }

    /// <inheritdoc />
    public async Task<Result<(byte[] Content, string FileName, string ContentType)>> DownloadAttachmentAsync(
        Guid attachmentId, CancellationToken ct = default)
    {
        var attachment = await _db.ProjectAttachments
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == attachmentId, ct);

        if (attachment is null)
            return Result<(byte[], string, string)>.Fail("Pièce jointe introuvable.");

        var physicalPath = Path.Combine(
            _env.WebRootPath ?? _env.ContentRootPath,
            attachment.StoragePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

        if (!File.Exists(physicalPath))
            return Result<(byte[], string, string)>.Fail("Fichier introuvable sur le serveur.");

        var content = await File.ReadAllBytesAsync(physicalPath, ct);

        return Result<(byte[], string, string)>.Ok(
            (content, attachment.FileName, attachment.ContentType));
    }

    /// <inheritdoc />
    public async Task<Result<long>> GetTotalStorageUsedAsync(CancellationToken ct = default)
    {
        var total = await _db.ProjectAttachments
            .AsNoTracking()
            .SumAsync(a => a.FileSize, ct);

        return Result<long>.Ok(total);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static ProjectAttachmentDto MapToDto(ProjectAttachment a) =>
        new(
            a.Id,
            a.ProjectId,
            a.UploadedByUserId,
            a.UploadedBy is not null
                ? $"{a.UploadedBy.FirstName} {a.UploadedBy.LastName}"
                : "Inconnu",
            a.FileName,
            a.FileExtension,
            a.ContentType,
            a.FileSize,
            FormatFileSize(a.FileSize),
            a.Description,
            a.Category.ToString(),
            a.UploadedAt,
            a.StoragePath
        );

    private static string FormatFileSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} o";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} Ko";
        return $"{bytes / (1024.0 * 1024.0):F1} Mo";
    }
}
