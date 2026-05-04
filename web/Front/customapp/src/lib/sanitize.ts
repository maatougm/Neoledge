import DOMPurify from 'dompurify'

/**
 * Canonical allow-list for sanitized HTML rendered via `v-html`.
 *
 * All user- or AI-originated HTML (markdown output, AI summaries,
 * transcript-derived prose, …) MUST flow through `sanitize()` before being
 * passed to Vue's `v-html`. Untrusted input (e.g. AI prompt-injection payloads
 * smuggled through meeting transcripts) can otherwise inject script-equivalent
 * markup.
 *
 * A call-site may define its own stricter allow-list where appropriate.
 * Such overrides are permitted — but the shared `sanitize()` is the
 * canonical default that every other v-html path must use.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']

const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta']

const FORBID_ATTR = [
  'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'formaction',
]

export function sanitize(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS,
    FORBID_ATTR,
  })
}
