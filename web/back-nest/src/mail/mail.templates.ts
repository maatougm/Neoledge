// ─── Email Templates ─────────────────────────────────────────────────────────
// All templates return self-contained HTML strings with inline styles.
// Brand color: #0d9488 (NeoLeadge teal)

const BRAND_COLOR = '#0d9488';
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

export function projectAssignedEmail(projectName: string, managerName: string): string {
  const body = `
    ${heading('Vous avez été assigné(e) à un projet')}
    ${paragraph(`Bonjour <strong>${managerName}</strong>,`)}
    ${paragraph(`Vous avez été désigné(e) comme chef de projet pour :`)}
    <div style="background-color:#f0fdfa;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:16px 0;border-radius:0 ${BORDER_RADIUS} ${BORDER_RADIUS} 0;">
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f766e;">${projectName}</p>
    </div>
    ${paragraph('Connectez-vous à NeoLeadge pour consulter les détails du projet et commencer la gestion.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Si vous pensez avoir reçu cet email par erreur, contactez votre administrateur.</span>')}
  `;
  return baseLayout(`Assignation au projet — ${projectName}`, body);
}

export function statusChangedEmail(
  projectName: string,
  oldStatus: string,
  newStatus: string,
): string {
  const body = `
    ${heading('Statut de projet mis à jour')}
    ${paragraph(`Le statut du projet <strong>${projectName}</strong> vient d'être modifié.`)}
    <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td style="padding-right:12px;">${badge(oldStatus, '#6b7280')}</td>
        <td style="padding-right:12px;font-size:18px;color:#9ca3af;">→</td>
        <td>${badge(newStatus)}</td>
      </tr>
    </table>
    ${paragraph('Connectez-vous à NeoLeadge pour consulter l\'avancement du projet.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Vous recevez cet email car vous êtes impliqué(e) dans ce projet.</span>')}
  `;
  return baseLayout(`Mise à jour du projet — ${projectName}`, body);
}

export function deadlineWarningEmail(
  projectName: string,
  daysLeft: number,
  endDate: string,
): string {
  const isCritical = daysLeft < 2;
  const alertColor = isCritical ? '#dc2626' : '#d97706';
  const alertLabel = isCritical ? 'ÉCHÉANCE CRITIQUE' : 'RAPPEL D\'ÉCHÉANCE';

  const body = `
    ${heading('Rappel d\'échéance de projet')}
    <div style="background-color:${isCritical ? '#fef2f2' : '#fffbeb'};border:1px solid ${alertColor};border-radius:${BORDER_RADIUS};padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px 0;font-size:12px;font-weight:700;color:${alertColor};text-transform:uppercase;letter-spacing:0.5px;">${alertLabel}</p>
      <p style="margin:0;font-size:15px;color:#111827;">Le projet <strong>${projectName}</strong> expire ${isCritical ? 'dans moins de 2 jours' : `dans <strong>${daysLeft} jours</strong>`}.</p>
    </div>
    ${paragraph(`<strong>Date d'échéance :</strong> ${endDate}`)}
    ${paragraph('Connectez-vous à NeoLeadge pour vérifier l\'état du projet et prendre les mesures nécessaires.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Vous recevez ce rappel automatique en tant que chef de projet ou administrateur.</span>')}
  `;
  return baseLayout(`Échéance — ${projectName}`, body);
}

export function phaseValidationEmail(
  projectName: string,
  phase: string,
  approvedBy: string,
): string {
  const body = `
    ${heading('Phase de projet validée')}
    ${paragraph(`Une phase du projet <strong>${projectName}</strong> a été validée.`)}
    <div style="background-color:#f0fdfa;border-left:4px solid ${BRAND_COLOR};padding:16px;margin:16px 0;border-radius:0 ${BORDER_RADIUS} ${BORDER_RADIUS} 0;">
      <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Phase validée</p>
      <p style="margin:0;font-size:16px;font-weight:600;color:#0f766e;">${phase}</p>
    </div>
    ${paragraph(`Validé par : <strong>${approvedBy}</strong>`)}
    ${paragraph('Consultez NeoLeadge pour voir les prochaines étapes du projet.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Vous recevez cet email car vous êtes impliqué(e) dans ce projet.</span>')}
  `;
  return baseLayout(`Phase validée — ${projectName}`, body);
}

export function commentMentionEmail(
  projectName: string,
  commenterName: string,
  commentPreview: string,
): string {
  const preview =
    commentPreview.length > 200 ? `${commentPreview.slice(0, 200)}…` : commentPreview;

  const body = `
    ${heading('Vous avez été mentionné(e) dans un commentaire')}
    ${paragraph(`<strong>${commenterName}</strong> vous a mentionné(e) dans un commentaire sur le projet <strong>${projectName}</strong> :`)}
    <blockquote style="margin:16px 0;padding:16px;background-color:#f9fafb;border-left:4px solid #d1d5db;border-radius:0 ${BORDER_RADIUS} ${BORDER_RADIUS} 0;font-size:14px;color:#374151;font-style:italic;">
      "${preview}"
    </blockquote>
    ${paragraph('Connectez-vous à NeoLeadge pour répondre au commentaire.')}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#6b7280;">Si vous pensez avoir reçu cet email par erreur, contactez votre administrateur.</span>')}
  `;
  return baseLayout(`Mention dans ${projectName}`, body);
}

export function passwordResetEmail(tempPassword: string): string {
  const body = `
    ${heading('Réinitialisation de votre mot de passe')}
    ${paragraph('Votre mot de passe NeoLeadge a été réinitialisé par un administrateur.')}
    ${paragraph('Voici votre mot de passe temporaire :')}
    <div style="background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:${BORDER_RADIUS};padding:16px;margin:16px 0;text-align:center;">
      <code style="font-size:22px;font-weight:700;color:#111827;letter-spacing:2px;font-family:monospace;">${tempPassword}</code>
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
