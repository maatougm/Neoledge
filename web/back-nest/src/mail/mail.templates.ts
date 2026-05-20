// ─── Email Templates ─────────────────────────────────────────────────────────
// All templates return self-contained HTML strings with inline styles.
// Brand color: #0d9488 (NeoLeadge teal)

const BRAND_COLOR = '#0d9488';

/**
 * Escape user-supplied strings before embedding in HTML email templates.
 * Prevents XSS via crafted project names, user names, or comment previews.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const BORDER_RADIUS = '6px';

function baseLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:${BORDER_RADIUS};overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">NeoLeadge</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Cet email est envoyé automatiquement par NeoLeadge — merci de ne pas y répondre.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${text}</h2>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;font-size:15px;color:#374151;line-height:1.6;">${text}</p>`;
}

function badge(text: string, color: string = BRAND_COLOR): string {
  return `<span style="display:inline-block;background-color:${color};color:#ffffff;font-size:13px;font-weight:600;padding:4px 12px;border-radius:4px;">${text}</span>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />`;
}

// ─── Template functions ───────────────────────────────────────────────────────
// Removed in cleanup pass: projectAssignedEmail, statusChangedEmail,
// phaseValidationEmail, commentMentionEmail — none had call sites in the
// codebase. The corresponding notification paths use in-app notifications
// (NotificationsService.notifyEnhanced) instead of email. If email for any
// of these events is needed in the future, restore from git history.

export function deadlineWarningEmail(
  projectName: string,
  daysLeft: number,
  endDate: string,
): string {
  const safeProjectName = escapeHtml(projectName);
  const safeEndDate = escapeHtml(endDate);
  const isCritical = daysLeft < 2;
  const alertColor = isCritical ? '#dc2626' : '#d97706';
  const alertLabel = isCritical ? 'ÉCHÉANCE CRITIQUE' : 'RAPPEL D\'ÉCHÉANCE';

  const body = `
    ${heading('Rappel d\'échéance de projet')}
    <div style="background-color:${isCritical ? '#fef2f2' : '#fffbeb'};border:1px solid ${alertColor};border-radius:${BORDER_RADIUS};padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:${alertColor};text-transform:uppercase;letter-spacing:0.5px;">${alertLabel}</p>
      <p style="margin:0;font-size:15px;color:#111827;">Le projet <strong>${safeProjectName}</strong> expire ${isCritical ? 'dans moins de 2 jours' : `dans <strong>${daysLeft} jours</strong>`}.</p>
    </div>
    ${paragraph(`<strong>Date d'échéance :</strong> ${safeEndDate}`)}
    ${paragraph('Connectez-vous à NeoLeadge pour vérifier l\'état du projet et prendre les mesures nécessaires.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Vous recevez ce rappel automatique en tant que chef de projet ou administrateur.</span>')}
  `;
  return baseLayout(`Échéance — ${safeProjectName}`, body);
}

export function forgotPasswordEmail(firstName: string, resetUrl: string): string {
  const safeName = escapeHtml(firstName);
  const safeUrl = escapeHtml(resetUrl);
  const body = `
    ${heading('Réinitialisation de votre mot de passe')}
    ${paragraph(`Bonjour <strong>${safeName}</strong>,`)}
    ${paragraph('Vous avez demandé la réinitialisation de votre mot de passe NeoLeadge. Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :')}
    <div style="text-align:center;margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:${BORDER_RADIUS};text-decoration:none;">
        Réinitialiser mon mot de passe
      </a>
    </div>
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Ce lien est valable pendant <strong>1 heure</strong>. Après ce délai, vous devrez faire une nouvelle demande.</span>')}
    ${divider()}
    <div style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:${BORDER_RADIUS};padding:12px 16px;">
      <p style="margin:0;font-size:13px;color:#92400e;">
        ⚠️ Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe ne sera pas modifié.
      </p>
    </div>
  `;
  return baseLayout('Réinitialisation de votre mot de passe NeoLeadge', body);
}

export function passwordResetEmail(tempPassword: string): string {
  const safeTempPassword = escapeHtml(tempPassword);
  const body = `
    ${heading('Réinitialisation de votre mot de passe')}
    ${paragraph('Votre mot de passe NeoLeadge a été réinitialisé par un administrateur.')}
    ${paragraph('Voici votre mot de passe temporaire :')}
    <div style="background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:${BORDER_RADIUS};padding:16px;margin:16px 0;text-align:center;">
      <code style="font-size:22px;font-weight:700;color:#111827;letter-spacing:2px;font-family:monospace;">${safeTempPassword}</code>
    </div>
    ${paragraph('Utilisez ce mot de passe temporaire pour vous connecter, puis <strong>changez-le immédiatement</strong> dans les paramètres de votre compte.')}
    ${divider()}
    <div style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:${BORDER_RADIUS};padding:12px 16px;">
      <p style="margin:0;font-size:13px;color:#92400e;">
        ⚠️ <strong>Important :</strong> Si vous n'avez pas demandé cette réinitialisation, contactez votre administrateur immédiatement.
      </p>
    </div>
  `;
  return baseLayout('Réinitialisation de votre mot de passe NeoLeadge', body);
}
