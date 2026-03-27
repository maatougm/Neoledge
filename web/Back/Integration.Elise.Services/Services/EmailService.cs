/**
 * @file     EmailService.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     SMTP-backed email notification service — disabled by default, logs instead of sending when Email:Enabled = false
 */

using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Configuration;
using Serilog;

namespace Integration.Elise.Services.Services;

/// <inheritdoc cref="IEmailService"/>
public class EmailService : IEmailService
{
    private readonly IConfiguration _config;
    private readonly bool _enabled;
    private readonly string _from;

    public EmailService(IConfiguration config)
    {
        _config  = config;
        _enabled = config.GetValue<bool>("Email:Enabled");
        _from    = config["Email:From"] ?? "noreply@neoleadge.com";
    }

    /// <inheritdoc/>
    public async Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        if (!_enabled)
        {
            Log.Information("Email disabled — would send to {To}: {Subject}", to, subject);
            return;
        }

        try
        {
            var host = _config["Email:Smtp:Host"] ?? "localhost";
            var port = _config.GetValue<int>("Email:Smtp:Port");
            var user = _config["Email:Smtp:Username"];
            var pass = _config["Email:Smtp:Password"];

            using var client = new SmtpClient(host, port)
            {
                EnableSsl   = _config.GetValue<bool>("Email:Smtp:EnableSsl"),
                Credentials = string.IsNullOrEmpty(user) ? null : new NetworkCredential(user, pass),
            };

            using var msg = new MailMessage(_from, to, subject, htmlBody) { IsBodyHtml = true };
            await client.SendMailAsync(msg, ct);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to send email to {To}: {Subject}", to, subject);
        }
    }

    /// <inheritdoc/>
    public async Task SendProjectAssignedAsync(string managerEmail, string managerName, string projectName, CancellationToken ct = default)
        => await SendAsync(
            managerEmail,
            $"[NeoLeadge] Vous avez été assigné au projet {projectName}",
            $"<p>Bonjour {managerName},</p>" +
            $"<p>Vous avez été désigné chef de projet pour <strong>{projectName}</strong>.</p>" +
            $"<p>Connectez-vous à NeoLeadge pour consulter les détails.</p>",
            ct);

    /// <inheritdoc/>
    public async Task SendStatusChangedAsync(string managerEmail, string managerName, string projectName, string oldStatus, string newStatus, CancellationToken ct = default)
        => await SendAsync(
            managerEmail,
            $"[NeoLeadge] Statut du projet {projectName} modifié",
            $"<p>Bonjour {managerName},</p>" +
            $"<p>Le statut du projet <strong>{projectName}</strong> a changé de <em>{oldStatus}</em> vers <em>{newStatus}</em>.</p>",
            ct);

    /// <inheritdoc/>
    public async Task SendValidationSubmittedAsync(string adminEmail, string validatorName, string projectName, string phase, bool isApproved, CancellationToken ct = default)
    {
        var decision = isApproved ? "approuvée ✓" : "refusée ✗";
        await SendAsync(
            adminEmail,
            $"[NeoLeadge] Validation {decision} — {projectName}",
            $"<p>La validation de la phase <strong>{phase}</strong> pour le projet <strong>{projectName}</strong> " +
            $"a été <strong>{decision}</strong> par {validatorName}.</p>",
            ct);
    }
}
