import type { ChoiceTask } from '../../ai/_decisions'
export { matchedResponses } from '../../ai/_choiceResponses'
import type { ClassificationIdentityEvidence } from '../../ai/_classificationEvidence'
import publicIdentities from '../../../../scripts/fixtures/decisions-paired-pubchem.json'
import reviewIdentities from '../../../../scripts/fixtures/decisions-review-identities.json'

export function fixedIdentityEvidence(cas?: string, cohort: 'paired' | 'review' = 'paired'): ClassificationIdentityEvidence {
  const number = cas?.trim()
  if (!number) return { status: 'not_supplied', cacheHit: false }
  if (cohort === 'review') {
    const material = reviewIdentities.materials.find(m => m.casNumber === number)
    return material ? { status: 'available', source: 'pubchem', cid: material.cid, casNumber: number, title: material.title,
      molecularFormula: material.molecularFormula, checkedAt: reviewIdentities.checkedAt, cacheHit: false } : { status: 'unavailable', cacheHit: false }
  }
  if (!Object.hasOwn(publicIdentities, number)) return { status: 'unavailable', cacheHit: false }
  return publicIdentities[number as keyof typeof publicIdentities] as ClassificationIdentityEvidence
}

export async function pairedInputDigest(task: ChoiceTask): Promise<string> {
  const shared = JSON.stringify([task.input, task.instructions, task.choices, task.abstain, task.blockedChoices ?? []])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shared))
  return Array.from(new Uint8Array(digest), octet => octet.toString(16).padStart(2, '0')).join('')
}
