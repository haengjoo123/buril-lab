import { useEffect, useMemo, useState } from 'react'
import { loadChemicalRegulations } from '../services/chemicalRegulationService'
import { normalizeCasNumber } from '../utils/casNumber'
import type { ChemicalRegulationLookup } from '../utils/chemicalRegulations'

const EMPTY = new Map<string, ChemicalRegulationLookup>()

/**
 * 화학물질관리법 classification for a list of CAS numbers, filled in as the
 * batch lookup answers. Keyed by normalized CAS; a CAS that is still unknown
 * is simply absent, so callers must not read absence as "not regulated".
 */
export function useChemicalRegulationMap(
  rawCasNumbers: readonly (string | null | undefined)[],
  enabled: boolean,
): Map<string, ChemicalRegulationLookup> {
  const casKey = useMemo(() => Array.from(new Set(rawCasNumbers
    .map((value) => normalizeCasNumber(value))
    .filter((value): value is string => Boolean(value))))
    .sort()
    .join(','), [rawCasNumbers])
  const [known, setKnown] = useState<Map<string, ChemicalRegulationLookup>>(EMPTY)

  useEffect(() => {
    if (!enabled || !casKey) return
    const controller = new AbortController()
    void loadChemicalRegulations(casKey.split(','), {
      signal: controller.signal,
      // Answers are per CAS, so earlier ones stay valid while the list changes.
      onProgress: (resolved) => {
        if (!controller.signal.aborted) setKnown((previous) => new Map([...previous, ...resolved]))
      },
    }).catch(() => {
      // Aborted or offline: the filter keeps whatever was already known.
    })
    return () => controller.abort()
  }, [casKey, enabled])

  return enabled ? known : EMPTY
}
