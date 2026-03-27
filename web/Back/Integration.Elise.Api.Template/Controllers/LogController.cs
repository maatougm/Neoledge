/**
 * @file     LogController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Returns recent application log lines for the admin log viewer
 */

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

[ApiController]
[Authorize]
[Route("admin/[controller]")]
public class LogController : ControllerBase
{
    private readonly IConfiguration _config;

    public LogController(IConfiguration config)
    {
        _config = config;
    }

    /// <summary>
    /// Returns the last <paramref name="lines"/> entries from today's application log file.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(IEnumerable<string>), StatusCodes.Status200OK)]
    public IActionResult GetRecentLogs([FromQuery] int lines = 200)
    {
        lines = Math.Clamp(lines, 1, 1000);

        var logPath = _config
            .GetSection("Serilog:WriteTo")
            .GetChildren()
            .SelectMany(s => s.GetSection("Args:configureLogger:WriteTo").GetChildren())
            .Select(s => s.GetSection("Args:path").Value)
            .FirstOrDefault(p => p is not null && p.Contains("log-") && !p.Contains("SOAP"));

        if (logPath is null)
            return Ok(new[] { "[config] Chemin du fichier log introuvable dans appsettings." });

        // Serilog rolling-by-day appends the date: "log-Exemple-.log" → "log-Exemple-20260326.log"
        var dir     = Path.GetDirectoryName(logPath) ?? "";
        var stem    = Path.GetFileNameWithoutExtension(logPath); // "log-Exemple-"
        var pattern = stem + "*.log";

        if (!Directory.Exists(dir))
            return Ok(new[] { $"[info] Répertoire de logs introuvable : {dir}" });

        var file = Directory
            .GetFiles(dir, pattern)
            .OrderByDescending(f => f)
            .FirstOrDefault();

        if (file is null)
            return Ok(new[] { "[info] Aucun fichier de log trouvé." });

        try
        {
            var allLines = System.IO.File.ReadLines(file).ToList();
            var tail     = allLines.TakeLast(lines).ToList();
            return Ok(tail);
        }
        catch (IOException ex)
        {
            return Ok(new[] { $"[error] Impossible de lire le fichier : {ex.Message}" });
        }
    }
}
