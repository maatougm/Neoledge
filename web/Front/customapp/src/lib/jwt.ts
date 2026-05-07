/** @file src/lib/jwt.ts — Pure JWT decode utilities (no external deps) */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string
  email?: string
  role?: string
  firstName?: string
  lastName?: string
  iat?: number
  exp?: number
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Safely decode the middle (payload) segment of a JWT using atob.
 * Returns null on any failure — never throws.
 *
 * UI DISPLAY ONLY. NEVER use for access control — the signature is NOT
 * verified here. All authoritative role checks must go through the
 * backend (JwtAuthGuard + RolesGuard).
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const segments = token.split('.')
    if (segments.length !== 3) return null
    // Base64url → Base64 → JSON
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    const raw = JSON.parse(json) as Record<string, unknown>

    // ASP.NET Core uses the full URI claim name for role
    const msRole =
      raw['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
    const msGivenName =
      raw['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname']
    const msSurname =
      raw['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']
    const msNameId =
      raw['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']

    return {
      sub:
        typeof raw['sub'] === 'string'
          ? raw['sub']
          : typeof msNameId === 'string'
            ? msNameId
            : '',
      email: typeof raw['email'] === 'string' ? raw['email'] : undefined,
      role:
        typeof raw['role'] === 'string'
          ? raw['role']
          : typeof msRole === 'string'
            ? msRole
            : undefined,
      firstName:
        typeof raw['firstName'] === 'string'
          ? raw['firstName']
          : typeof raw['given_name'] === 'string'
            ? raw['given_name']
            : typeof msGivenName === 'string'
              ? msGivenName
              : undefined,
      lastName:
        typeof raw['lastName'] === 'string'
          ? raw['lastName']
          : typeof raw['family_name'] === 'string'
            ? raw['family_name']
            : typeof msSurname === 'string'
              ? msSurname
              : undefined,
      iat: typeof raw['iat'] === 'number' ? raw['iat'] : undefined,
      exp: typeof raw['exp'] === 'number' ? raw['exp'] : undefined,
    }
  } catch {
    return null
  }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/** Returns the role claim from the JWT, or null if unavailable. */
export function getUserRole(token: string): string | null {
  return decodeJwt(token)?.role ?? null
}

/**
 * Returns the first letter of firstName + first letter of lastName.
 * Falls back to the first two characters of the email, then '??'.
 */
export function getUserInitials(token: string): string {
  const payload = decodeJwt(token)
  if (!payload) return '??'
  const first = payload.firstName?.[0]?.toUpperCase() ?? ''
  const last = payload.lastName?.[0]?.toUpperCase() ?? ''
  if (first || last) return `${first}${last}`
  if (payload.email && payload.email.length >= 2) {
    return payload.email.slice(0, 2).toUpperCase()
  }
  return '??'
}

/**
 * Returns "FirstName LastName", falling back to email, then empty string.
 */
export function getUserFullName(token: string): string {
  const payload = decodeJwt(token)
  if (!payload) return ''
  const parts = [payload.firstName, payload.lastName].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return payload.email ?? ''
}

/** Returns the `sub` claim (user ID) or null. */
export function getUserId(token: string): string | null {
  const payload = decodeJwt(token)
  if (!payload) return null
  return payload.sub || null
}

/**
 * Returns true when the JWT's `exp` claim is in the past, or when `exp` is
 * absent (no unbounded sessions — treat missing exp as expired to be safe).
 *
 * NOTE: `decodeJwt` performs base64 decode only and does NOT verify the
 * signature. Never use it as an authoritative authentication decision — only
 * for client-side UI hints (e.g. proactively refreshing before an API call).
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token)
  if (!payload) return true
  if (payload.exp === undefined) return true
  return payload.exp < Date.now() / 1000
}
