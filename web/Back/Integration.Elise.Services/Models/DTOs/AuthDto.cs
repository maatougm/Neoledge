/**
 * @file     AuthDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     DTOs for authentication — login request only; JWT is assembled in the API layer
 */

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>Credentials submitted by the user on the login form.</summary>
public record LoginRequestDto(string Email, string Password);


