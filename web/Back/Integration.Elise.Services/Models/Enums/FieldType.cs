/**
 * @file     FieldType.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Enumeration of supported project field value types
 */

namespace Integration.Elise.Services.Models.Enums;

/// <summary>Data type of a project field.</summary>
public enum FieldType
{
    Text,
    Number,
    Date,
    Select,
    Checkbox
}
