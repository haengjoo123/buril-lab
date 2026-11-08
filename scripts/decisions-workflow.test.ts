import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Deployment contract helper is JavaScript.
import { verifyDecisionsEvaluationWorkflow } from './verify-cloudflare-release-config.mjs'
const source = readFileSync('.github/workflows/decisions-evaluation.yml', 'utf8')
describe('Staging-only remote evaluation workflow contract', () => {
  it('accepts the exact workflow including Windows line endings', () => {
    expect(verifyDecisionsEvaluationWorkflow(source)).toBe(true)
    expect(verifyDecisionsEvaluationWorkflow(source.replace(/\r?\n/g, '\r\n'))).toBe(true)
  })
  it.each([
    source.replace('environment: staging', 'environment: production'),
    source.replace('contents: read', 'contents: write'),
    source.replace('refs/heads/main', 'refs/heads/untrusted'),
    source.replace('grant.json', 'private.json'),
    source.replace('secrets.STAGING_ACCESS_CLIENT_SECRET', 'secrets.OPENAI_API_KEY'),
  ])('rejects changed privilege, branch, artifact or credential scope', changed => {
    expect(() => verifyDecisionsEvaluationWorkflow(changed)).toThrow()
  })
})
