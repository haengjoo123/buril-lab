export function verifyGate0EnrichmentIsolation({ featureFlag, blockedRequests, byPhase = undefined }) {
  if (featureFlag !== 'true' && featureFlag !== 'false') {
    throw new Error('Gate0 chemical enrichment flag must be exactly true or false.')
  }
  if (!Number.isInteger(blockedRequests) || blockedRequests < 0) {
    throw new Error('Gate0 blocked enrichment request count must be a non-negative integer.')
  }

  if (featureFlag === 'false') {
    if (blockedRequests !== 0) {
      throw new Error(`Disabled chemical enrichment attempted a request (blockedRequests=${blockedRequests}; expected=0).`)
    }
    return { featureEnabled: false, blockedRequests }
  }

  // Inventory lookup, disposal lookup, then one draft lookup plus its retry.
  // Permit that complete flow only with phase evidence; record views may not query.
  if (byPhase !== undefined) {
    const limits = { inventory: 1, batch: 3, record: 0, directLink: 0 }
    if (!byPhase || typeof byPhase !== 'object' || Array.isArray(byPhase)
      || Object.keys(byPhase).sort().join(',') !== Object.keys(limits).sort().join(',')) {
      throw new Error('Gate0 enrichment phase evidence is incomplete.')
    }
    for (const [phase, limit] of Object.entries(limits)) {
      if (!Number.isInteger(byPhase[phase]) || byPhase[phase] < 0 || byPhase[phase] > limit) {
        throw new Error(`Gate0 enrichment exceeded the ${phase} phase budget.`)
      }
    }
    if (Object.values(byPhase).reduce((sum, count) => sum + count, 0) !== blockedRequests) {
      throw new Error('Gate0 enrichment phase evidence does not match the total.')
    }
  }
  const maximum = byPhase === undefined ? 3 : 4
  if (blockedRequests < 1 || blockedRequests > maximum) {
    throw new Error(`Enabled chemical enrichment must stay within the blocked Gate0 attempt budget (blockedRequests=${blockedRequests}; expected=1..${maximum}).`)
  }
  return { featureEnabled: true, blockedRequests }
}
