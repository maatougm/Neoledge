/**
 * @file jwt.spec.ts — unit tests for the JWT decode utilities.
 *
 * The decoder is pure (no fetch, no DOM) — we hand-craft a JWT by
 * base64-encoding a known payload and concatenating it with throwaway
 * header/signature segments.
 */

import { describe, it, expect } from 'vitest'
import {
  decodeJwt,
  getUserRole,
  getUserInitials,
  getUserFullName,
  getUserId,
  isTokenExpired,
} from './jwt'

/** Build a JWT with the given payload. Header + signature are placeholders. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.sig`
}

describe('decodeJwt', () => {
  it('parses a standard payload', () => {
    const tok = makeJwt({ sub: 'u1', email: 'a@b.com', role: 'Admin', firstName: 'Alice', lastName: 'B' })
    expect(decodeJwt(tok)).toEqual({
      sub: 'u1',
      email: 'a@b.com',
      role: 'Admin',
      firstName: 'Alice',
      lastName: 'B',
      iat: undefined,
      exp: undefined,
    })
  })

  it('returns null when token has wrong number of segments', () => {
    expect(decodeJwt('only.two')).toBeNull()
    expect(decodeJwt('a.b.c.d')).toBeNull()
    expect(decodeJwt('justone')).toBeNull()
  })

  it('returns null when the payload is not valid base64', () => {
    expect(decodeJwt('hdr.@@@notbase64@@@.sig')).toBeNull()
  })

  it('returns null when the payload is not valid JSON', () => {
    const tok = `hdr.${btoa('not json')}.sig`
    expect(decodeJwt(tok)).toBeNull()
  })

  it('translates base64url chars (- and _) back to + and /', () => {
    // Force a payload that produces - and _ in base64url
    const tok = makeJwt({ sub: 'u', data: '???????' }).replace(/\+/g, '-').replace(/\//g, '_')
    const decoded = decodeJwt(tok)
    expect(decoded?.sub).toBe('u')
  })

  it('falls back to ASP.NET MS claim URIs when standard keys missing', () => {
    const tok = makeJwt({
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'ProjectManager',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Bob',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'Smith',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'u-net',
    })
    const decoded = decodeJwt(tok)
    expect(decoded?.sub).toBe('u-net')
    expect(decoded?.role).toBe('ProjectManager')
    expect(decoded?.firstName).toBe('Bob')
    expect(decoded?.lastName).toBe('Smith')
  })

  it('uses given_name / family_name as fallback before MS claim URIs', () => {
    const tok = makeJwt({ sub: 'u', given_name: 'GivenName', family_name: 'FamilyName' })
    const decoded = decodeJwt(tok)
    expect(decoded?.firstName).toBe('GivenName')
    expect(decoded?.lastName).toBe('FamilyName')
  })

  it('returns empty sub when no sub or MS nameidentifier present', () => {
    const tok = makeJwt({ email: 'x@y.com' })
    expect(decodeJwt(tok)?.sub).toBe('')
  })

  it('only sets iat/exp when they are numbers (not strings)', () => {
    const tok = makeJwt({ sub: 'u', iat: 'not a number', exp: 'also bad' })
    const decoded = decodeJwt(tok)
    expect(decoded?.iat).toBeUndefined()
    expect(decoded?.exp).toBeUndefined()
  })
})

describe('getUserRole', () => {
  it('returns the role claim', () => {
    expect(getUserRole(makeJwt({ sub: 'u', role: 'Admin' }))).toBe('Admin')
  })
  it('returns null for invalid token', () => {
    expect(getUserRole('bad')).toBeNull()
  })
  it('returns null when role is absent', () => {
    expect(getUserRole(makeJwt({ sub: 'u' }))).toBeNull()
  })
})

describe('getUserInitials', () => {
  it('returns first+last initial when both present', () => {
    expect(getUserInitials(makeJwt({ sub: 'u', firstName: 'Alice', lastName: 'Bert' }))).toBe('AB')
  })
  it('uses just first initial when last is missing', () => {
    expect(getUserInitials(makeJwt({ sub: 'u', firstName: 'Alice' }))).toBe('A')
  })
  it('falls back to first two letters of email when no first/last', () => {
    expect(getUserInitials(makeJwt({ sub: 'u', email: 'maatoug@x.com' }))).toBe('MA')
  })
  it('returns ?? when token is invalid', () => {
    expect(getUserInitials('bad')).toBe('??')
  })
  it('returns ?? when payload is bare', () => {
    expect(getUserInitials(makeJwt({ sub: 'u' }))).toBe('??')
  })
  it('returns ?? when email is too short to slice 2 chars', () => {
    expect(getUserInitials(makeJwt({ sub: 'u', email: 'a' }))).toBe('??')
  })
})

describe('getUserFullName', () => {
  it('returns "First Last"', () => {
    expect(getUserFullName(makeJwt({ sub: 'u', firstName: 'Alice', lastName: 'Bert' }))).toBe('Alice Bert')
  })
  it('returns just first when last missing', () => {
    expect(getUserFullName(makeJwt({ sub: 'u', firstName: 'Alice' }))).toBe('Alice')
  })
  it('falls back to email when no first/last', () => {
    expect(getUserFullName(makeJwt({ sub: 'u', email: 'a@b.com' }))).toBe('a@b.com')
  })
  it('returns empty string when nothing available', () => {
    expect(getUserFullName(makeJwt({ sub: 'u' }))).toBe('')
  })
  it('returns empty string when token invalid', () => {
    expect(getUserFullName('bad')).toBe('')
  })
})

describe('getUserId', () => {
  it('returns sub claim', () => {
    expect(getUserId(makeJwt({ sub: 'u-123' }))).toBe('u-123')
  })
  it('returns null when sub is empty string', () => {
    // The decoder sets sub: '' when missing; the helper should normalise empty to null.
    expect(getUserId(makeJwt({ email: 'a@b.com' }))).toBeNull()
  })
  it('returns null when token invalid', () => {
    expect(getUserId('bad')).toBeNull()
  })
})

describe('isTokenExpired', () => {
  it('returns true when exp is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 60
    expect(isTokenExpired(makeJwt({ sub: 'u', exp: past }))).toBe(true)
  })
  it('returns false when exp is in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    expect(isTokenExpired(makeJwt({ sub: 'u', exp: future }))).toBe(false)
  })
  it('returns true when exp is missing — no unbounded sessions allowed', () => {
    expect(isTokenExpired(makeJwt({ sub: 'u' }))).toBe(true)
  })
  it('returns true when token cannot be decoded', () => {
    expect(isTokenExpired('not.a.jwt')).toBe(true)
  })
})
