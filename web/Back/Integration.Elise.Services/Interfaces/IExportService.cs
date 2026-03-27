/**
 * @file     IExportService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Service contract for exporting project data
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Exports project data to various formats (PDF, Excel, CSV).
/// </summary>
public interface IExportService
{
    /// <summary>Exports projects to the specified format.</summary>
    Task<Result<ExportResultDto>> ExportProjectsAsync(ExportProjectsRequestDto request, CancellationToken ct = default);

    /// <summary>Generates a detailed PDF report for a single project.</summary>
    Task<Result<ExportResultDto>> GenerateProjectReportAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Exports projects to Excel format.</summary>
    Task<Result<byte[]>> ExportToExcelAsync(List<Guid> projectIds, CancellationToken ct = default);

    /// <summary>Exports projects to CSV format.</summary>
    Task<Result<byte[]>> ExportToCsvAsync(List<Guid> projectIds, CancellationToken ct = default);
}
