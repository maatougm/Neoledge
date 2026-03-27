/**
 * @file     ProjectStatus.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Enumeration of project lifecycle states
 */

namespace Integration.Elise.Services.Models.Enums;

/// <summary>Ordered lifecycle states of a deployment project.</summary>
public enum ProjectStatus
{
    Draft,
    InProgress,
    SpecificationValidation,
    Realization,
    DeploymentValidation,
    Completed,
    Archived
}
