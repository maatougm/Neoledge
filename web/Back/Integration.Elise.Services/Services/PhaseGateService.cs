/**
 * @file     PhaseGateService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     Enforces phase gate rules for project status transitions
 */

using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Services;

/// <summary>
/// Determines whether a project may transition from one lifecycle status to another,
/// enforcing approval gates for guarded phases.
/// </summary>
public interface IPhaseGateService
{
    /// <summary>
    /// Returns whether the transition from <paramref name="from"/> to <paramref name="to"/>
    /// is permitted for the given project, along with an optional rejection reason.
    /// </summary>
    Task<(bool Allowed, string? Reason)> CanTransitionAsync(
        Guid projectId,
        ProjectStatus from,
        ProjectStatus to,
        CancellationToken ct = default);
}

/// <inheritdoc cref="IPhaseGateService"/>
public class PhaseGateService : IPhaseGateService
{
    private readonly ApplicationDbContext _db;

    public PhaseGateService(ApplicationDbContext db) => _db = db;

    /// <summary>
    /// Ordered map of the single valid forward transition for each status.
    /// Archived is always reachable from any status and is handled separately.
    /// </summary>
    private static readonly IReadOnlyDictionary<ProjectStatus, ProjectStatus> ValidTransitions =
        new Dictionary<ProjectStatus, ProjectStatus>
        {
            [ProjectStatus.Draft]                  = ProjectStatus.InProgress,
            [ProjectStatus.InProgress]             = ProjectStatus.SpecificationValidation,
            [ProjectStatus.SpecificationValidation] = ProjectStatus.Realization,
            [ProjectStatus.Realization]            = ProjectStatus.DeploymentValidation,
            [ProjectStatus.DeploymentValidation]   = ProjectStatus.Completed,
        };

    /// <inheritdoc/>
    public async Task<(bool Allowed, string? Reason)> CanTransitionAsync(
        Guid projectId,
        ProjectStatus from,
        ProjectStatus to,
        CancellationToken ct = default)
    {
        // Archiving is always permitted regardless of current status.
        if (to == ProjectStatus.Archived)
            return (true, null);

        // Verify the target is the single valid next step from the current status.
        if (!ValidTransitions.TryGetValue(from, out var expected) || expected != to)
            return (false, $"Transition invalide de {from} vers {to}.");

        // Gate: SpecificationValidation → Realization requires an approved validation.
        if (to == ProjectStatus.Realization)
        {
            var hasApproval = await _db.ProjectValidations
                .AnyAsync(
                    v => v.ProjectId == projectId
                         && v.Phase == ProjectStatus.SpecificationValidation
                         && v.IsApproved,
                    ct);

            if (!hasApproval)
                return (false,
                    "La phase de validation de spécification nécessite au moins une validation approuvée.");
        }

        // Gate: DeploymentValidation → Completed requires an approved validation.
        if (to == ProjectStatus.Completed)
        {
            var hasApproval = await _db.ProjectValidations
                .AnyAsync(
                    v => v.ProjectId == projectId
                         && v.Phase == ProjectStatus.DeploymentValidation
                         && v.IsApproved,
                    ct);

            if (!hasApproval)
                return (false,
                    "La phase de validation de déploiement nécessite au moins une validation approuvée.");
        }

        return (true, null);
    }
}
