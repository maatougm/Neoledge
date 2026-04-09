/**
 * @file     IMeetingTranscriptionService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     Contract for meeting audio transcription via OpenAI Whisper
 */

using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.DTOs;

namespace Integration.Elise.Services.Interfaces;

/// <summary>
/// Transcribes meeting audio files, persists the results, and provides CRUD access to transcripts.
/// </summary>
public interface IMeetingTranscriptionService
{
    /// <summary>Transcribes an audio stream via Whisper and saves the transcript to the database.</summary>
    Task<Result<MeetingTranscriptDetailDto>> TranscribeAsync(
        Guid projectId, Stream audioStream, string fileName, TranscribeRequestDto request, CancellationToken ct);

    /// <summary>Returns all transcripts for a project, ordered by creation date descending.</summary>
    Task<Result<IReadOnlyList<MeetingTranscriptSummaryDto>>> GetByProjectAsync(Guid projectId, CancellationToken ct);

    /// <summary>Returns a single transcript with all segments.</summary>
    Task<Result<MeetingTranscriptDetailDto>> GetByIdAsync(Guid transcriptId, CancellationToken ct);

    /// <summary>Deletes a transcript and all its segments.</summary>
    Task<Result> DeleteAsync(Guid transcriptId, CancellationToken ct);

    /// <summary>Renames a speaker label across all segments of a transcript.</summary>
    Task<Result> RenameSpeakerAsync(Guid transcriptId, string oldName, string newName, CancellationToken ct);
}
