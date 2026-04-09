/**
 * @file     PaginatedResult.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-04-01
 * @desc     Generic paginated result wrapper for skip/take pagination endpoints
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>
/// Lightweight pagination envelope using skip/take semantics.
/// </summary>
public record PaginatedResult<T>(
    IReadOnlyList<T> Items,
    int Total,
    int Skip,
    int Take
);
