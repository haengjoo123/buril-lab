import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Requester lookups per list call. Each lookup is one Supabase Auth subrequest, so a 200-row list
 * cannot check everyone; the oldest pending requests are the ones an operator decides next.
 */
export const REQUESTER_DOMAIN_LOOKUP_LIMIT = 20

/** A lookup slower than this counts as failed, so one stuck Auth call cannot hold up the list. */
export const REQUESTER_DOMAIN_LOOKUP_TIMEOUT_MS = 3_000

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/
/** Characters that would make the URL parser read part of the value as a user, path, query or fragment. */
const NON_HOST_CHARACTERS = /[\s/\\?#@]/

export interface SafetyCenterRequesterDomain {
  /** Lowercased part of the requester's email after '@'. The address itself is never returned. */
  requester_email_domain: string | null
  /**
   * True when the requester domain equals the institution domain or is one of its subdomains
   * (chem.buril.ac.kr matches buril.ac.kr; evilburil.ac.kr does not). False also when the
   * institution domain is not a host name, so the operator still sees the requester domain.
   * Null when not checked (no lookup, or the requester domain is unknown).
   */
  domain_matches: boolean | null
}

interface RequesterDomainRow {
  status: string
  created_by: string | null
  created_at: string
  institution_domain: string | null
}

type AuthAdminClient = Pick<SupabaseClient, 'auth'>

function asDomain(value: string): string | null {
  return value.length <= MAX_DOMAIN_LENGTH && DOMAIN_PATTERN.test(value) ? value : null
}

/**
 * The host name both sides are compared as: lowercased ASCII, with a port and trailing dots
 * dropped and an international name (버릴대.kr) in its punycode form (xn--vk1b30kypc.kr), the
 * way email addresses carry it. Null when the value is not a host name.
 */
function toHostName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || NON_HOST_CHARACTERS.test(trimmed)) return null
  let host: string
  try {
    host = new URL(`http://${trimmed}`).hostname
  } catch {
    return null
  }
  host = host.replace(/\.+$/, '')
  return host ? asDomain(host) : null
}

/**
 * Institution domain as typed by the applicant: trimmed, lowercased, without a scheme, a path, a
 * leading '@' or 'www.', then as a host name (see toHostName).
 */
export function normalizeInstitutionDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let domain = value.trim().toLowerCase().replace(/^https?:\/\//, '')
  domain = domain.split(/[/?#]/, 1)[0]
  if (domain.startsWith('@')) domain = domain.slice(1)
  if (domain.startsWith('www.')) domain = domain.slice(4)
  return toHostName(domain)
}

/** The lowercased part after the last '@', or null when the value is not an address with a local part. */
export function emailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return null
  return toHostName(trimmed.slice(at + 1))
}

export function requesterDomainMatches(requesterDomain: string, institutionDomain: string): boolean {
  return requesterDomain === institutionDomain || requesterDomain.endsWith(`.${institutionDomain}`)
}

function createdTime(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
}

async function fetchEmailDomain(adminClient: AuthAdminClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await adminClient.auth.admin.getUserById(userId)
    if (error) return null
    return emailDomain(data?.user?.email)
  } catch {
    // A failed lookup only hides the chip for that request; the list itself must still load.
    return null
  }
}

async function lookupEmailDomain(adminClient: AuthAdminClient, userId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REQUESTER_DOMAIN_LOOKUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fetchEmailDomain(adminClient, userId), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Adds `requester_email_domain` and `domain_matches` to the oldest pending requests (at most
 * REQUESTER_DOMAIN_LOOKUP_LIMIT), looked up concurrently. Every other row, and every row whose
 * lookup failed or took longer than REQUESTER_DOMAIN_LOOKUP_TIMEOUT_MS, gets null for both.
 * Only the domain leaves this function, never the email.
 */
export async function withRequesterDomains<T extends RequesterDomainRow>(
  adminClient: AuthAdminClient,
  rows: readonly T[],
): Promise<Array<T & SafetyCenterRequesterDomain>> {
  const lookupRows = new Set(
    rows
      .filter((row) => row.status === 'pending')
      .sort((a, b) => createdTime(a.created_at) - createdTime(b.created_at))
      .slice(0, REQUESTER_DOMAIN_LOOKUP_LIMIT),
  )

  const lookups = new Map<string, Promise<string | null>>()
  for (const row of lookupRows) {
    const userId = typeof row.created_by === 'string' ? row.created_by.trim() : ''
    if (userId && !lookups.has(userId)) lookups.set(userId, lookupEmailDomain(adminClient, userId))
  }
  const domains = new Map<string, string | null>(
    await Promise.all([...lookups].map(async ([userId, lookup]) => [userId, await lookup] as const)),
  )

  return rows.map((row) => {
    if (!lookupRows.has(row)) return { ...row, requester_email_domain: null, domain_matches: null }
    const requesterDomain = typeof row.created_by === 'string' ? domains.get(row.created_by.trim()) ?? null : null
    const institutionDomain = normalizeInstitutionDomain(row.institution_domain)
    return {
      ...row,
      requester_email_domain: requesterDomain,
      // An institution domain that is not a host name cannot vouch for the requester: show the
      // mismatch (with the requester domain) instead of hiding the check.
      domain_matches: requesterDomain
        ? institutionDomain !== null && requesterDomainMatches(requesterDomain, institutionDomain)
        : null,
    }
  })
}
