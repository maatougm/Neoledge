/**
 * @file     IEmailService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Contract for outbound email notifications (project assignment, status changes, validation results)
 */

namespace Integration.Elise.Services.Services;

/// <summary>
/// Sends transactional email notifications for project lifecycle events.
/// Can be disabled via <c>Email:Enabled = false</c> in configuration (dry-run mode logs instead of sending).
/// </summary>
public interface IEmailService
{
    /// <summary>Sends a raw HTML email.</summary>
    Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default);

    /// <summary>Notifies a project manager that they have been assigned to a project.</summary>
    Task SendProjectAssignedAsync(string managerEmail, string managerName, string projectName, CancellationToken ct = default);

    /// <summary>Notifies a project manager that the status of their project has changed.</summary>
    Task SendStatusChangedAsync(string managerEmail, string managerName, string projectName, string oldStatus, string newStatus, CancellationToken ct = default);

    /// <summary>Notifies an admin that a validation decision (approval or rejection) has been submitted for a project phase.</summary>
    Task SendValidationSubmittedAsync(string adminEmail, string validatorName, string projectName, string phase, bool isApproved, CancellationToken ct = default);
}
