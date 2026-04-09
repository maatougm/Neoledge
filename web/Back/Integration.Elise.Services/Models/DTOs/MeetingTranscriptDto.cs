/**
 * @file     MeetingTranscriptDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     DTOs for meeting transcription — summary, detail, segment, and request payloads
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>Lightweight transcript summary for list views.</summary>
public record MeetingTranscriptSummaryDto(
    Guid Id,
    string Title,
    int DurationSeconds,
    string DetectedLanguages,
    int SegmentCount,
    DateTime RecordedAt,
    DateTime CreatedAt
);

/// <summary>Single transcript segment with timing and speaker info.</summary>
public record TranscriptSegmentDto(
    Guid Id,
    string Speaker,
    string Text,
    double StartTime,
    double EndTime,
    string Language,
    double Confidence
);

/// <summary>Full transcript with all segments.</summary>
public record MeetingTranscriptDetailDto(
    Guid Id,
    Guid ProjectId,
    string Title,
    int DurationSeconds,
    string DetectedLanguages,
    DateTime RecordedAt,
    DateTime CreatedAt,
    IReadOnlyList<TranscriptSegmentDto> Segments
);

/// <summary>
/// Request payload for transcription.
/// <para>
/// <c>SpeakerMap</c> is optional JSON: <c>[{"start":0,"end":30,"speaker":"PM"},{"start":30,"end":60,"speaker":"Client"}]</c>
/// </para>
/// </summary>
public record TranscribeRequestDto(
    string Title,
    string? SpeakerMap
);

/// <summary>Request payload for renaming a speaker label across all segments.</summary>
public record RenameSpeakerDto(string OldName, string NewName);
