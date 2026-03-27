/**
 * @file     FieldCategory.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Enumeration categorising whether a field is static, dynamic, or custom
 */

namespace Integration.Elise.Services.Models.Enums;

/// <summary>Indicates who defined the field and when.</summary>
public enum FieldCategory
{
    /// <summary>Auto-seeded at project creation by the system.</summary>
    Static,
    /// <summary>Added by the ProjectManager after project creation.</summary>
    Dynamic,
    /// <summary>Custom ad-hoc fields added by authorised users.</summary>
    Custom
}
