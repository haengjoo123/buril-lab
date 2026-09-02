export function verifyGate0EnrichmentIsolation({ featureFlag, blockedRequests }) {
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

  if (blockedRequests < 1 || blockedRequests > 3) {
    throw new Error(`Enabled chemical enrichment must stay within the blocked Gate0 attempt budget (blockedRequests=${blockedRequests}; expected=1..3).`)
  }
  return { featureEnabled: true, blockedRequests }
}
