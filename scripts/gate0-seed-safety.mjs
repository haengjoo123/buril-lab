export const GATE0_STAGING_PROJECT_REF = 'qpgnomuqdcucjmxrunnw'
export const GATE0_STAGING_ORIGIN = `https://${GATE0_STAGING_PROJECT_REF}.supabase.co`
export const GATE0_STAGING_CONFIRMATION = `SEED GATE0 SYNTHETIC DATA ${GATE0_STAGING_PROJECT_REF}`
export const GATE0_RESERVED_LAB_ID = '10000000-0000-4000-8000-000000000010'
export const GATE0_RESERVED_INVENTORY_ID = '20000000-0000-4000-8000-000000000010'
export const GATE0_RESERVED_POLICY_ID = '50000000-0000-4000-8000-000000000010'
export const GATE0_OWNER_MARKER = 'burillab-gate0-synthetic'
export const GATE0_LAB_NAME = 'Gate0 합성 연구실'
export const GATE0_INVENTORY_NAME = 'Gate0 Synthetic Powder'
export const GATE0_POLICY_NAME = 'Gate0 합성 시스템 폐기 정책'

export const GATE0_ISOLATION_EVIDENCE_KEYS = Object.freeze([
  'fixtureMembershipsOutsideReservedLab',
  'otherMembershipsInsideReservedLab',
  'fixtureLabsOutsideReservedLab',
  'fixturePoliciesOutsideReservedPolicy',
  'otherPoliciesInsideReservedLab',
  'fixtureInventoryOutsideReservedLab',
  'otherInventoryInsideReservedLab',
  'fixtureStorageLocationsOutsideReservedLab',
  'otherStorageLocationsInsideReservedLab',
  'fixtureCabinetsOutsideReservedLab',
  'otherCabinetsInsideReservedLab',
  'fixtureWasteLogsOutsideReservedLab',
  'otherWasteLogsInsideReservedLab',
  'fixtureOverridesOutsideReservedLab',
  'otherOverridesInsideReservedLab',
])

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function selectExistingFixtureUser(users, fixtureEmail) {
  const expectedEmail = normalizedEmail(fixtureEmail)
  const matches = users.filter((user) => normalizedEmail(user?.email) === expectedEmail)
  if (matches.length > 1) {
    throw new Error('Gate0 seed found duplicate users for the synthetic fixture email.')
  }
  return matches[0] || null
}

export function verifyExistingFixtureOwnership({
  user,
  lab,
  inventory,
  policy,
  membership,
}) {
  const hasReservedState = Boolean(lab || inventory || policy || membership)
  if (!user) {
    if (hasReservedState) {
      throw new Error('Gate0 seed found reserved fixture data without its synthetic owner.')
    }
    return null
  }

  if (user.user_metadata?.synthetic !== true) {
    throw new Error('Gate0 seed refuses to delete a non-synthetic user with the fixture email.')
  }
  const hasReservedOwnerMarker = (
    user.app_metadata?.synthetic === true
    && user.app_metadata?.gate0_owner_marker === GATE0_OWNER_MARKER
    && user.app_metadata?.gate0_lab_id === GATE0_RESERVED_LAB_ID
  )
  if (!hasReservedOwnerMarker) {
    throw new Error('Gate0 seed refuses automatic deletion without the trusted reserved app_metadata owner marker; review and run convert-gate0-legacy-owner.mjs manually if this is an approved legacy fixture.')
  }
  if (lab) {
    if (lab.id !== GATE0_RESERVED_LAB_ID || lab.created_by !== user.id) {
      throw new Error('Gate0 seed refuses a fixture user that does not own the reserved lab.')
    }
    if (membership && (
      membership.lab_id !== lab.id
      || membership.user_id !== user.id
      || membership.role !== 'admin'
    )) {
      throw new Error('Gate0 seed refuses a fixture user with a mismatched reserved membership.')
    }
  } else {
    if (inventory || membership) {
      throw new Error('Gate0 seed found dependent fixture data without the reserved lab.')
    }
  }
  if (inventory && (inventory.lab_id !== GATE0_RESERVED_LAB_ID || inventory.user_id !== user.id)) {
    throw new Error('Gate0 seed refuses reserved inventory owned outside the synthetic fixture.')
  }
  if (policy && (policy.created_by !== user.id || policy.activated_by !== user.id)) {
    throw new Error('Gate0 seed refuses a reserved policy owned outside the synthetic fixture.')
  }
  return user
}

export function verifyFixtureIsolationEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Gate0 isolation evidence is missing or malformed.')
  }
  for (const key of GATE0_ISOLATION_EVIDENCE_KEYS) {
    const count = evidence[key]
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Gate0 isolation evidence is incomplete for ${key}.`)
    }
    if (count !== 0) {
      throw new Error(`Gate0 seed refuses deletion because ${key} is not empty.`)
    }
  }
  return true
}

export function legacyConversionConfirmation(userId) {
  return `CONVERT LEGACY GATE0 OWNER ${GATE0_STAGING_PROJECT_REF} ${userId}`
}

export function verifyLegacyFixtureConversion({
  user,
  fixtureEmail,
  expectedUserId,
  confirmation,
  lab,
  inventory,
  policy,
  membership,
}) {
  if (!user || user.id !== expectedUserId) {
    throw new Error('Gate0 legacy conversion requires the exact expected user UUID.')
  }
  if (normalizedEmail(user.email) !== normalizedEmail(fixtureEmail)) {
    throw new Error('Gate0 legacy conversion user does not match the fixture email.')
  }
  if (confirmation !== legacyConversionConfirmation(user.id)) {
    throw new Error('Gate0 legacy conversion requires the exact user-specific confirmation.')
  }
  if (user.user_metadata?.synthetic !== true) {
    throw new Error('Gate0 legacy conversion refuses a user without the legacy synthetic marker.')
  }
  if (
    user.app_metadata?.gate0_owner_marker !== undefined
    || user.app_metadata?.gate0_lab_id !== undefined
  ) {
    throw new Error('Gate0 legacy conversion refuses existing or conflicting reserved ownership metadata.')
  }
  if (
    !lab
    || lab.id !== GATE0_RESERVED_LAB_ID
    || lab.name !== GATE0_LAB_NAME
    || lab.created_by !== user.id
  ) {
    throw new Error('Gate0 legacy conversion requires the complete reserved lab owned by the exact user.')
  }
  if (
    !membership
    || membership.lab_id !== GATE0_RESERVED_LAB_ID
    || membership.user_id !== user.id
    || membership.role !== 'admin'
  ) {
    throw new Error('Gate0 legacy conversion requires the exact reserved admin membership.')
  }
  if (
    !inventory
    || inventory.id !== GATE0_RESERVED_INVENTORY_ID
    || inventory.lab_id !== GATE0_RESERVED_LAB_ID
    || inventory.user_id !== user.id
    || inventory.name !== GATE0_INVENTORY_NAME
  ) {
    throw new Error('Gate0 legacy conversion requires the complete reserved inventory fixture.')
  }
  if (
    !policy
    || policy.id !== GATE0_RESERVED_POLICY_ID
    || policy.name !== GATE0_POLICY_NAME
    || policy.scope_type !== 'system'
    || policy.created_by !== user.id
    || policy.activated_by !== user.id
  ) {
    throw new Error('Gate0 legacy conversion requires the complete reserved policy fixture.')
  }

  return {
    ...user.app_metadata,
    synthetic: true,
    gate0_owner_marker: GATE0_OWNER_MARKER,
    gate0_lab_id: GATE0_RESERVED_LAB_ID,
  }
}
