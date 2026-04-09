/**
 * @file     MeetingTranscriptionService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     Sends audio to local Python transcription service (with OpenAI fallback),
 *           parses segments, persists transcripts
 */

using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.DTOs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Integration.Elise.Services.Services;

/// <summary>
/// Transcribes meeting audio via the local Python transcription service
/// (with OpenAI Whisper API fallback), maps speaker labels,
/// and persists the result in the database.
/// </summary>
public class MeetingTranscriptionService : IMeetingTranscriptionService
{
    private readonly ApplicationDbContext _db;
    private readonly HttpClient _httpClient;
    private readonly string _openAiApiKey;
    private readonly string _localServiceUrl;
    private readonly Serilog.ILogger _logger;

    public MeetingTranscriptionService(
        ApplicationDbContext db,
        HttpClient httpClient,
        IConfiguration config,
        Serilog.ILogger logger)
    {
        _db = db;
        _httpClient = httpClient;
        _openAiApiKey = config["OpenAI:ApiKey"] ?? string.Empty;
        _localServiceUrl = config["Transcription:ServiceUrl"] ?? "http://localhost:8000";
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result<MeetingTranscriptDetailDto>> TranscribeAsync(
        Guid projectId, Stream audioStream, string fileName, TranscribeRequestDto request, CancellationToken ct)
    {
        var speakerOverrides = ParseSpeakerMap(request.SpeakerMap);

        // ── Try local Python transcription service first ────────────────────
        var localResult = await TryLocalServiceAsync(
            projectId, audioStream, fileName, request.Title, speakerOverrides, ct);

        if (localResult.IsSuccess)
            return localResult;

        _logger.Warning(
            "Local transcription service unavailable, attempting OpenAI fallback. Reason: {Error}",
            localResult.Error);

        // ── Fall back to OpenAI Whisper API ─────────────────────────────────
        if (string.IsNullOrEmpty(_openAiApiKey))
        {
            return Result<MeetingTranscriptDetailDto>.Fail(
                "Service de transcription local indisponible et aucune clé API OpenAI configurée.");
        }

        // Reset stream position for the fallback call
        if (audioStream.CanSeek)
            audioStream.Position = 0;

        return await TranscribeViaOpenAiAsync(
            projectId, audioStream, fileName, request.Title, speakerOverrides, ct);
    }

    /// <inheritdoc />
    public async Task<Result<IReadOnlyList<MeetingTranscriptSummaryDto>>> GetByProjectAsync(
        Guid projectId, CancellationToken ct)
    {
        var list = await _db.MeetingTranscripts
            .Where(t => t.ProjectId == projectId)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new MeetingTranscriptSummaryDto(
                t.Id, t.Title, t.DurationSeconds, t.DetectedLanguages,
                t.Segments.Count, t.RecordedAt, t.CreatedAt))
            .ToListAsync(ct);

        return Result<IReadOnlyList<MeetingTranscriptSummaryDto>>.Ok(list);
    }

    /// <inheritdoc />
    public async Task<Result<MeetingTranscriptDetailDto>> GetByIdAsync(Guid transcriptId, CancellationToken ct)
    {
        var entity = await _db.MeetingTranscripts
            .Include(t => t.Segments.OrderBy(s => s.StartTime))
            .FirstOrDefaultAsync(t => t.Id == transcriptId, ct);

        if (entity is null)
            return Result<MeetingTranscriptDetailDto>.Fail("Transcription introuvable.");

        return Result<MeetingTranscriptDetailDto>.Ok(MapToDetail(entity));
    }

    /// <inheritdoc />
    public async Task<Result> DeleteAsync(Guid transcriptId, CancellationToken ct)
    {
        var entity = await _db.MeetingTranscripts
            .Include(t => t.Segments)
            .FirstOrDefaultAsync(t => t.Id == transcriptId, ct);

        if (entity is null)
            return Result.Fail("Transcription introuvable.");

        _db.MeetingTranscripts.Remove(entity);
        await _db.SaveChangesAsync(ct);
        return Result.Ok();
    }

    /// <inheritdoc />
    public async Task<Result> RenameSpeakerAsync(
        Guid transcriptId, string oldName, string newName, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(oldName) || string.IsNullOrWhiteSpace(newName))
            return Result.Fail("L'ancien et le nouveau nom du locuteur sont requis.");

        var entity = await _db.MeetingTranscripts
            .Include(t => t.Segments)
            .FirstOrDefaultAsync(t => t.Id == transcriptId, ct);

        if (entity is null)
            return Result.Fail("Transcription introuvable.");

        var matchingSegments = entity.Segments.Where(s => s.Speaker == oldName).ToList();

        if (matchingSegments.Count == 0)
            return Result.Fail($"Aucun segment trouvé pour le locuteur « {oldName} ».");

        foreach (var segment in matchingSegments)
        {
            segment.Speaker = newName;
        }

        await _db.SaveChangesAsync(ct);

        _logger.Information(
            "Renamed speaker '{OldName}' to '{NewName}' in {Count} segments of transcript {Id}",
            oldName, newName, matchingSegments.Count, transcriptId);

        return Result.Ok();
    }

    // ── Local Python service ────────────────────────────────────────────────

    private async Task<Result<MeetingTranscriptDetailDto>> TryLocalServiceAsync(
        Guid projectId, Stream audioStream, string fileName, string title,
        List<SpeakerRange> speakerOverrides, CancellationToken ct)
    {
        var url = $"{_localServiceUrl.TrimEnd('/')}/transcribe";

        using var content = new MultipartFormDataContent();
        var streamContent = new StreamContent(audioStream);
        streamContent.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
        content.Add(streamContent, "audio", fileName);

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(
                new HttpRequestMessage(HttpMethod.Post, url) { Content = content }, ct);
        }
        catch (Exception ex)
        {
            _logger.Warning(ex, "Local transcription service unreachable at {Url}", url);
            return Result<MeetingTranscriptDetailDto>.Fail(
                $"Service de transcription local injoignable : {ex.Message}");
        }

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            _logger.Warning(
                "Local transcription service error {Status}: {Body}", response.StatusCode, errorBody);
            return Result<MeetingTranscriptDetailDto>.Fail(
                $"Erreur du service de transcription local ({response.StatusCode}).");
        }

        var json = await response.Content.ReadAsStringAsync(ct);
        var localResponse = JsonSerializer.Deserialize<LocalTranscriptionResponse>(json, JsonOptions);

        if (localResponse is null)
            return Result<MeetingTranscriptDetailDto>.Fail("Réponse de transcription locale invalide.");

        // ── Build domain entity from local service response ─────────────
        var detectedLanguages = localResponse.DetectedLanguages is { Count: > 0 }
            ? string.Join(", ", localResponse.DetectedLanguages)
            : "unknown";

        var transcript = new MeetingTranscript
        {
            ProjectId = projectId,
            Title = title,
            OriginalFileName = fileName,
            DurationSeconds = (int)(localResponse.DurationSeconds ?? 0),
            DetectedLanguages = detectedLanguages,
        };

        if (localResponse.Segments is not null)
        {
            foreach (var seg in localResponse.Segments)
            {
                // Use SpeakerMap override if provided, otherwise use the service's label
                var speaker = ResolveSpeakerWithOverride(
                    seg.StartTime, seg.EndTime, seg.Speaker, speakerOverrides);

                transcript.Segments.Add(new TranscriptSegment
                {
                    TranscriptId = transcript.Id,
                    Speaker = speaker ?? "Unknown",
                    Text = seg.Text?.Trim() ?? string.Empty,
                    StartTime = seg.StartTime,
                    EndTime = seg.EndTime,
                    Language = seg.Language ?? "unknown",
                    Confidence = seg.Confidence ?? 0,
                });
            }
        }

        _db.MeetingTranscripts.Add(transcript);
        await _db.SaveChangesAsync(ct);

        _logger.Information(
            "Transcription created {Id} via local service for project {ProjectId}, {SegmentCount} segments",
            transcript.Id, projectId, transcript.Segments.Count);

        return Result<MeetingTranscriptDetailDto>.Ok(MapToDetail(transcript));
    }

    // ── OpenAI Whisper fallback ─────────────────────────────────────────────

    private async Task<Result<MeetingTranscriptDetailDto>> TranscribeViaOpenAiAsync(
        Guid projectId, Stream audioStream, string fileName, string title,
        List<SpeakerRange> speakerRanges, CancellationToken ct)
    {
        using var content = new MultipartFormDataContent();
        var streamContent = new StreamContent(audioStream);
        streamContent.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
        content.Add(streamContent, "file", fileName);
        content.Add(new StringContent("whisper-1"), "model");
        content.Add(new StringContent("verbose_json"), "response_format");

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post, "https://api.openai.com/v1/audio/transcriptions");
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _openAiApiKey);
        httpRequest.Content = content;

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, ct);
        }
        catch (Exception ex)
        {
            _logger.Error(ex, "Whisper API call failed");
            return Result<MeetingTranscriptDetailDto>.Fail(
                "Erreur de connexion au service de transcription OpenAI.");
        }

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            _logger.Warning("Whisper API error {Status}: {Body}", response.StatusCode, errorBody);
            return Result<MeetingTranscriptDetailDto>.Fail(
                $"Erreur du service de transcription OpenAI ({response.StatusCode}).");
        }

        var json = await response.Content.ReadAsStringAsync(ct);
        var whisperResponse = JsonSerializer.Deserialize<WhisperResponse>(json, JsonOptions);

        if (whisperResponse is null)
            return Result<MeetingTranscriptDetailDto>.Fail("Réponse de transcription OpenAI invalide.");

        // ── Build domain entity ─────────────────────────────────────────
        var transcript = new MeetingTranscript
        {
            ProjectId = projectId,
            Title = title,
            OriginalFileName = fileName,
            DurationSeconds = (int)(whisperResponse.Duration ?? 0),
            DetectedLanguages = whisperResponse.Language ?? "unknown",
        };

        if (whisperResponse.Segments is not null)
        {
            foreach (var seg in whisperResponse.Segments)
            {
                var speaker = ResolveSpeaker(seg.Start, seg.End, speakerRanges);
                transcript.Segments.Add(new TranscriptSegment
                {
                    TranscriptId = transcript.Id,
                    Speaker = speaker,
                    Text = seg.Text?.Trim() ?? string.Empty,
                    StartTime = seg.Start,
                    EndTime = seg.End,
                    Language = whisperResponse.Language ?? "unknown",
                    Confidence = seg.AvgLogprob.HasValue ? Math.Exp(seg.AvgLogprob.Value) : 0,
                });
            }
        }

        _db.MeetingTranscripts.Add(transcript);
        await _db.SaveChangesAsync(ct);

        _logger.Information(
            "Transcription created {Id} via OpenAI fallback for project {ProjectId}, {SegmentCount} segments",
            transcript.Id, projectId, transcript.Segments.Count);

        return Result<MeetingTranscriptDetailDto>.Ok(MapToDetail(transcript));
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private static MeetingTranscriptDetailDto MapToDetail(MeetingTranscript t) =>
        new(t.Id, t.ProjectId, t.Title, t.DurationSeconds, t.DetectedLanguages,
            t.RecordedAt, t.CreatedAt,
            t.Segments.OrderBy(s => s.StartTime).Select(s =>
                new TranscriptSegmentDto(s.Id, s.Speaker, s.Text, s.StartTime, s.EndTime, s.Language, s.Confidence)
            ).ToList());

    /// <summary>
    /// Resolves speaker for a local-service segment. If a SpeakerMap override
    /// matches the time range, it takes precedence; otherwise the service's own
    /// speaker label is used.
    /// </summary>
    private static string ResolveSpeakerWithOverride(
        double start, double end, string? serviceSpeaker, List<SpeakerRange> overrides)
    {
        if (overrides.Count > 0)
        {
            var mid = (start + end) / 2;
            var match = overrides.FirstOrDefault(r => mid >= r.Start && mid <= r.End);
            if (match is not null)
                return match.Speaker;
        }

        return serviceSpeaker ?? "Unknown";
    }

    /// <summary>
    /// Resolves speaker purely from the time-range SpeakerMap (used by OpenAI fallback
    /// which does not provide speaker labels).
    /// </summary>
    private static string ResolveSpeaker(double start, double end, List<SpeakerRange> ranges)
    {
        if (ranges.Count == 0) return "Unknown";
        var mid = (start + end) / 2;
        var match = ranges.FirstOrDefault(r => mid >= r.Start && mid <= r.End);
        return match?.Speaker ?? "Unknown";
    }

    private static List<SpeakerRange> ParseSpeakerMap(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<SpeakerRange>();
        try
        {
            return JsonSerializer.Deserialize<List<SpeakerRange>>(json, JsonOptions)
                   ?? new List<SpeakerRange>();
        }
        catch
        {
            return new List<SpeakerRange>();
        }
    }

    // ── Internal models for JSON deserialization ─────────────────────────────

    private record SpeakerRange(double Start, double End, string Speaker);

    /// <summary>Response shape from the local Python transcription service.</summary>
    private record LocalTranscriptionResponse(
        [property: JsonPropertyName("duration_seconds")] double? DurationSeconds,
        [property: JsonPropertyName("detected_languages")] List<string>? DetectedLanguages,
        [property: JsonPropertyName("speaker_count")] int? SpeakerCount,
        [property: JsonPropertyName("segments")] List<LocalSegment>? Segments,
        [property: JsonPropertyName("full_text")] string? FullText
    );

    private record LocalSegment(
        [property: JsonPropertyName("speaker")] string? Speaker,
        [property: JsonPropertyName("text")] string? Text,
        [property: JsonPropertyName("start_time")] double StartTime,
        [property: JsonPropertyName("end_time")] double EndTime,
        [property: JsonPropertyName("language")] string? Language,
        [property: JsonPropertyName("confidence")] double? Confidence
    );

    /// <summary>Response shape from OpenAI Whisper API.</summary>
    private record WhisperResponse(
        string? Language,
        double? Duration,
        string? Text,
        List<WhisperSegment>? Segments
    );

    private record WhisperSegment(
        double Start,
        double End,
        string? Text,
        double? AvgLogprob
    );
}
