/**
 * @file     ExportDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for exporting project data
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>Export format options.</summary>
public enum ExportFormat
{
    Pdf,
    Excel,
    Csv,
    Json
}

/// <summary>Request to export projects.</summary>
public record ExportProjectsRequestDto(
    List<Guid>? ProjectIds,
    ExportFormat Format,
    bool IncludeFields = true,
    bool IncludeAttachments = false,
    bool IncludeComments = false,
    bool IncludeActivity = true
);

/// <summary>Export result with download URL.</summary>
public record ExportResultDto(
    string FileName,
    string ContentType,
    long FileSize,
    string DownloadUrl,
    DateTime ExpiresAt
);

/// <summary>Project data for PDF report.</summary>
public record ProjectReportDto(
    ProjectDetailDto Project,
    List<ProjectFieldDto> Fields,
    List<ProjectActivityDto> Activities,
    List<ProjectValidationDto> Validations,
    List<ProjectCommentDto> Comments,
    List<ProjectAttachmentDto> Attachments,
    DateTime GeneratedAt
);
