/**
 * @file     MeetingController.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     REST endpoints for meeting audio transcription (local service + OpenAI fallback)
 */

using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers;

/// <summary>
/// Manages meeting audio uploads and transcripts for a given project.
/// </summary>
[ApiController]
[Authorize]
[Route("pm/projects/{projectId:guid}/meetings")]
public class MeetingController : ControllerBase
{
    private readonly IMeetingTranscriptionService _service;
    private readonly Serilog.ILogger _logger;

    public MeetingController(IMeetingTranscriptionService service, Serilog.ILogger logger)
    {
        _service = service;
        _logger  = logger;
    }

    /// <summary>Uploads an audio file and returns the Whisper transcription.</summary>
    [HttpPost("upload")]
    [RequestSizeLimit(100_000_000)] // 100 MB
    [ProducesResponseType(typeof(MeetingTranscriptDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Upload(
        Guid projectId,
        [FromForm] IFormFile audio,
        [FromForm] string title,
        [FromForm] string? speakerMap,
        CancellationToken ct)
    {
        if (audio is null || audio.Length == 0)
            return BadRequest(new { error = "Fichier audio requis." });

        var allowedTypes = new[]
        {
            "audio/mpeg", "audio/mp3", "audio/wav", "audio/webm",
            "audio/ogg", "audio/mp4", "audio/m4a"
        };

        if (!allowedTypes.Contains(audio.ContentType) && !audio.FileName.EndsWith(".webm"))
            return BadRequest(new { error = "Format audio non supporté. Formats acceptés : MP3, WAV, WebM, OGG, M4A." });

        using var stream = audio.OpenReadStream();
        var request = new TranscribeRequestDto(title, speakerMap);
        var result = await _service.TranscribeAsync(projectId, stream, audio.FileName, request, ct);

        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Lists all transcripts for a project.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<MeetingTranscriptSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetByProject(Guid projectId, CancellationToken ct)
    {
        var result = await _service.GetByProjectAsync(projectId, ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    /// <summary>Gets a single transcript with all segments.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(MeetingTranscriptDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid projectId, Guid id, CancellationToken ct)
    {
        var result = await _service.GetByIdAsync(id, ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    /// <summary>Deletes a transcript and all its segments.</summary>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid projectId, Guid id, CancellationToken ct)
    {
        var result = await _service.DeleteAsync(id, ct);
        return result.IsSuccess ? NoContent() : NotFound(new { error = result.Error });
    }

    /// <summary>Renames a speaker label across all segments of a transcript.</summary>
    [HttpPatch("{id:guid}/rename-speaker")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RenameSpeaker(
        Guid projectId, Guid id,
        [FromBody] RenameSpeakerDto dto,
        CancellationToken ct)
    {
        if (dto is null || string.IsNullOrWhiteSpace(dto.OldName) || string.IsNullOrWhiteSpace(dto.NewName))
            return BadRequest(new { error = "L'ancien et le nouveau nom du locuteur sont requis." });

        var result = await _service.RenameSpeakerAsync(id, dto.OldName, dto.NewName, ct);
        return result.IsSuccess ? NoContent() : NotFound(new { error = result.Error });
    }
}
