/**
 * @file     ExportService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Export service — CSV and JSON export of project data (PDF/Excel require external libs)
 */

using System.Text;
using System.Text.Json;
using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Integration.Elise.Services.Services;

/// <inheritdoc />
public class ExportService : IExportService
{
    private readonly ApplicationDbContext _db;
    private readonly ILogger<ExportService> _logger;

    public ExportService(ApplicationDbContext db, ILogger<ExportService> logger)
    {
        _db     = db;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result<ExportResultDto>> ExportProjectsAsync(
        ExportProjectsRequestDto request, CancellationToken ct = default)
    {
        return request.Format switch
        {
            ExportFormat.Csv  => await ExportProjectsAsCsvResult(request, ct),
            ExportFormat.Json => await ExportProjectsAsJsonResult(request, ct),
            _ => Result<ExportResultDto>.Fail($"Format '{request.Format}' non supporté. Utilisez Csv ou Json.")
        };
    }

    /// <inheritdoc />
    public async Task<Result<ExportResultDto>> GenerateProjectReportAsync(
        Guid projectId, CancellationToken ct = default)
    {
        var project = await _db.Projects
            .AsNoTracking()
            .Include(p => p.ProjectManager)
            .Include(p => p.Fields)
            .Include(p => p.FieldValues)
            .FirstOrDefaultAsync(p => p.Id == projectId, ct);

        if (project is null)
            return Result<ExportResultDto>.Fail("Projet introuvable.");

        var sb = new StringBuilder();
        sb.AppendLine($"RAPPORT DE PROJET — {project.Name}");
        sb.AppendLine($"Généré le : {DateTime.UtcNow:dd/MM/yyyy HH:mm} UTC");
        sb.AppendLine(new string('─', 60));
        sb.AppendLine($"Client       : {project.ClientName}");
        sb.AppendLine($"Statut       : {project.Status}");
        sb.AppendLine($"Priorité     : {project.Priority}");
        sb.AppendLine($"Chef de proj.: {(project.ProjectManager is not null ? $"{project.ProjectManager.FirstName} {project.ProjectManager.LastName}" : "Non assigné")}");
        sb.AppendLine($"Date début   : {project.StartDate:dd/MM/yyyy}");
        sb.AppendLine($"Date fin     : {project.EndDate:dd/MM/yyyy}");
        sb.AppendLine();
        sb.AppendLine("CHAMPS DU QUESTIONNAIRE");
        sb.AppendLine(new string('─', 40));

        foreach (var field in project.Fields.OrderBy(f => f.OrderIndex))
        {
            var value = project.FieldValues.FirstOrDefault(v => v.ProjectFieldId == field.Id);
            sb.AppendLine($"  {field.Label}: {value?.Value ?? "(vide)"}");
        }

        var bytes    = Encoding.UTF8.GetBytes(sb.ToString());
        var fileName = $"rapport_{project.Name.Replace(" ", "_")}_{DateTime.UtcNow:yyyyMMdd}.txt";

        _logger.LogInformation("Generated text report for project {ProjectId}", projectId);

        return Result<ExportResultDto>.Ok(new ExportResultDto(
            fileName,
            "text/plain; charset=utf-8",
            bytes.Length,
            $"/api/export/download/{projectId}",
            DateTime.UtcNow.AddHours(1)
        ));
    }

    /// <inheritdoc />
    public async Task<Result<byte[]>> ExportToExcelAsync(
        List<Guid> projectIds, CancellationToken ct = default)
    {
        // Excel requires a third-party lib (ClosedXML, EPPlus) — return CSV as fallback
        _logger.LogWarning("ExportToExcel called but not fully implemented; returning CSV");
        return await ExportToCsvAsync(projectIds, ct);
    }

    /// <inheritdoc />
    public async Task<Result<byte[]>> ExportToCsvAsync(
        List<Guid> projectIds, CancellationToken ct = default)
    {
        IQueryable<Integration.Elise.Services.Models.Domain.Project> query = _db.Projects
            .AsNoTracking()
            .Include(p => p.ProjectManager);

        if (projectIds.Count > 0)
            query = query.Where(p => projectIds.Contains(p.Id));

        var projects = await query
            .OrderBy(p => p.Name)
            .ToListAsync(ct);

        var sb = new StringBuilder();

        // BOM + header
        sb.Append('\uFEFF');
        sb.AppendLine("Id,Nom,Client,Statut,Priorité,Chef de projet,Date début,Date fin,Créé le");

        foreach (var p in projects)
        {
            var pm = p.ProjectManager is not null
                ? $"{p.ProjectManager.FirstName} {p.ProjectManager.LastName}"
                : "";

            sb.AppendLine(string.Join(",",
                p.Id,
                QuoteCsv(p.Name),
                QuoteCsv(p.ClientName),
                p.Status,
                p.Priority,
                QuoteCsv(pm),
                p.StartDate.ToString("yyyy-MM-dd"),
                p.EndDate.ToString("yyyy-MM-dd"),
                p.CreatedAt.ToString("yyyy-MM-dd")
            ));
        }

        return Result<byte[]>.Ok(Encoding.UTF8.GetBytes(sb.ToString()));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Result<ExportResultDto>> ExportProjectsAsCsvResult(
        ExportProjectsRequestDto request, CancellationToken ct)
    {
        var csvResult = await ExportToCsvAsync(request.ProjectIds ?? new List<Guid>(), ct);
        if (csvResult.IsFailure)
            return Result<ExportResultDto>.Fail(csvResult.Error!);

        var fileName = $"projets_{DateTime.UtcNow:yyyyMMdd_HHmmss}.csv";
        return Result<ExportResultDto>.Ok(new ExportResultDto(
            fileName,
            "text/csv; charset=utf-8",
            csvResult.Value!.Length,
            $"/api/export/download/{fileName}",
            DateTime.UtcNow.AddHours(1)
        ));
    }

    private async Task<Result<ExportResultDto>> ExportProjectsAsJsonResult(
        ExportProjectsRequestDto request, CancellationToken ct)
    {
        var query = _db.Projects
            .AsNoTracking()
            .Include(p => p.ProjectManager);

        IQueryable<Integration.Elise.Services.Models.Domain.Project> filtered = query;
        if (request.ProjectIds is { Count: > 0 })
            filtered = query.Where(p => request.ProjectIds.Contains(p.Id));

        var projects = await filtered.OrderBy(p => p.Name).ToListAsync(ct);

        var data = projects.Select(p => new
        {
            p.Id,
            p.Name,
            p.ClientName,
            Status    = p.Status.ToString(),
            Priority  = p.Priority.ToString(),
            ProjectManager = p.ProjectManager is not null
                ? $"{p.ProjectManager.FirstName} {p.ProjectManager.LastName}" : null,
            StartDate = p.StartDate.ToString("yyyy-MM-dd"),
            EndDate   = p.EndDate.ToString("yyyy-MM-dd"),
            CreatedAt = p.CreatedAt.ToString("yyyy-MM-dd")
        });

        var json     = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
        var bytes    = Encoding.UTF8.GetBytes(json);
        var fileName = $"projets_{DateTime.UtcNow:yyyyMMdd_HHmmss}.json";

        return Result<ExportResultDto>.Ok(new ExportResultDto(
            fileName,
            "application/json",
            bytes.Length,
            $"/api/export/download/{fileName}",
            DateTime.UtcNow.AddHours(1)
        ));
    }

    private static string QuoteCsv(string value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
