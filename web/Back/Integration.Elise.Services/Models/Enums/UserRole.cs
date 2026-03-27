/**
 * @file     UserRole.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Enumeration of all application roles
 */

namespace Integration.Elise.Services.Models.Enums;

/// <summary>Application roles controlling access to features and data.</summary>
public enum UserRole
{
    Admin,
    ProjectManager,
    SpecificationTeam,
    RealizationTeam,
    DeploymentTeam,
    Viewer
}
