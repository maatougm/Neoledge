/**
 * @file     MeetingTranscript.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     Domain entities for meeting audio transcription and transcript segments
 */

namespace Integration.Elise.Services.Models.Domain;

/// <summary>
/// A transcribed meeting recording attached to a project.
/// Created by sending audio to the local Python transcription service
/// (with OpenAI Whisper API as fallback).
/// </summary>
public class MeetingTranscript
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the project this transcript belongs to.</summary>
    public Guid ProjectId { get; set; }

    /// <summary>User-provided title for the meeting.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Original audio file name.</summary>
    public string? OriginalFileName { get; set; }

    /// <summary>Duration of the audio in seconds.</summary>
    public int DurationSeconds { get; set; }

    /// <summary>Comma-separated detected languages, e.g. "fr,ar,en".</summary>
    public string DetectedLanguages { get; set; } = string.Empty;

    /// <summary>UTC timestamp of when the meeting was recorded.</summary>
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    /// <summary>UTC creation timestamp.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ── Navigation properties ────────────────────────────────────────────────

    /// <summary>Parent project.</summary>
    public Project Project { get; set; } = null!;

    /// <summary>Ordered transcript segments produced by Whisper.</summary>
    public ICollection<TranscriptSegment> Segments { get; set; } = new List<TranscriptSegment>();
}

/// <summary>
/// A single timed segment within a <see cref="MeetingTranscript"/>.
/// </summary>
public class TranscriptSegment
{
    /// <summary>Primary key (GUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>FK to the parent transcript.</summary>
    public Guid TranscriptId { get; set; }

    /// <summary>Speaker label — "PM", "Client", or "Unknown".</summary>
    public string Speaker { get; set; } = "Unknown";

    /// <summary>Transcribed text for this segment.</summary>
    public string Text { get; set; } = string.Empty;

    /// <summary>Start time in seconds.</summary>
    public double StartTime { get; set; }

    /// <summary>End time in seconds.</summary>
    public double EndTime { get; set; }

    /// <summary>ISO 639-1 language code, e.g. "fr", "ar", "en".</summary>
    public string Language { get; set; } = string.Empty;

    /// <summary>Confidence score (0–1) derived from Whisper avg_logprob.</summary>
    public double Confidence { get; set; }

    // ── Navigation ───────────────────────────────────────────────────────────

    /// <summary>Parent transcript.</summary>
    public MeetingTranscript Transcript { get; set; } = null!;
}
