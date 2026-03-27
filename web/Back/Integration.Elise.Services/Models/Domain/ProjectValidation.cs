/**
 * @file     ProjectValidation.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Team validation record for a project lifecycle phase
 */

using Integration.Elise.Services.Models.Enums;

namespace Integration.Elise.Services.Models.Domain;

/// <summary>
/// Records a team member's approval or rejection of a project at a specific lifecycle phase.
/// </summary>
public class ProjectValidation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public Guid ValidatedByUserId { get; set; }
    public string ValidatedByRole { get; set; } = string.Empty;
    public ProjectStatus Phase { get; set; }
    public bool IsApproved { get; set; }
    public string? Comment { get; set; }
    public DateTime ValidatedAt { get; set; } = DateTime.UtcNow;
    public Project? Project { get; set; }
    public AppUser? ValidatedBy { get; set; }
}
