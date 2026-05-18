/**
 * Best-effort PII scrubber applied to free-text inputs (transcripts,
 * comments) before they leave our backend for any LLM provider. Catches
 * the most common identifiers; does NOT pretend to be a complete DLP
 * solution — for that you need a dedicated service (Microsoft Presidio,
 * Google DLP, etc.).
 *
 * The output keeps the same length and structure (we replace with tokens
 * of similar shape) so the LLM can still tell *that* a phone or email
 * was said without seeing the actual digits.
 */

// Email — RFC-ish, intentionally lenient on the local part.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

// IBAN — country code (2 letters) + 2 check digits + up to 30 alphanumerics.
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g

// French phone formats (00 33 …, +33 …, 0X XX XX XX XX with various spacers).
// Also catches generic 9–15 digit runs with separators.
const PHONE_FR = /(?:\+?33|0)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/g
const PHONE_GENERIC = /\b\+?\d[\d\s.\-]{8,16}\d\b/g

// French SIRET / SIREN (14 / 9 digits), Tunisian RNE (8 digits), passport-ish.
const FR_SIRET = /\b\d{14}\b/g
const FR_SIREN = /\b\d{9}\b/g

// Credit-card-ish (13–19 digits, with common spacers). Luhn skipped — we
// over-redact rather than miss.
const CARD = /\b(?:\d[\s-]?){13,19}\b/g

// French IBAN bypasses the generic numeric runs above, so apply IBAN first.

const REDACTORS: Array<{ name: string; re: RegExp; token: string }> = [
  { name: 'email', re: EMAIL, token: '<email-redacted>' },
  { name: 'iban', re: IBAN, token: '<iban-redacted>' },
  { name: 'card', re: CARD, token: '<card-redacted>' },
  { name: 'phone-fr', re: PHONE_FR, token: '<phone-redacted>' },
  { name: 'phone', re: PHONE_GENERIC, token: '<phone-redacted>' },
  { name: 'siret', re: FR_SIRET, token: '<siret-redacted>' },
  { name: 'siren', re: FR_SIREN, token: '<siren-redacted>' },
]

export interface RedactionStats {
  /** Map of pattern name → number of matches replaced. */
  readonly counts: Readonly<Record<string, number>>
  /** Total matches replaced. */
  readonly total: number
}

/**
 * Returns a redacted copy of `text` and a count of what was masked.
 * Never throws; bad input → returns input unchanged with zero counts.
 */
export function redactPii(text: string): { text: string; stats: RedactionStats } {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: text ?? '', stats: { counts: {}, total: 0 } }
  }
  const counts: Record<string, number> = {}
  let out = text
  for (const { name, re, token } of REDACTORS) {
    let n = 0
    out = out.replace(re, () => {
      n++
      return token
    })
    if (n > 0) counts[name] = n
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { text: out, stats: { counts, total } }
}
