/**
 * @file     PmDto.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     DTOs for project manager operations — questionnaire saves and team validations
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.DTOs;

/// <summary>One field-value update in a questionnaire save.</summary>
public record SaveFieldValueDto(Guid ProjectFieldId, string? Value);

/// <summary>Payload for saving the full questionnaire.</summary>
public record SaveQuestionnaireDto(IEnumerable<SaveFieldValueDto> FieldValues);

/// <summary>Payload for submitting a team validation.</summary>
public record SubmitValidationDto(bool IsApproved, string? Comment);

/// <summary>Represents a single team validation in responses.</summary>
public record ProjectValidationDto(
    Guid Id,
    Guid ProjectId,
    string ValidatedByRole,
    string ValidatedByName,
    ProjectStatus Phase,
    bool IsApproved,
    string? Comment,
    DateTime ValidatedAt
);
