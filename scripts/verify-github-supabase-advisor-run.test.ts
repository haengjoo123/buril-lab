import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchTrustedSupabaseAdvisorRun,
  findTrustedSupabaseAdvisorRun,
  SUPABASE_ADVISOR_RUN_MAX_AGE_MS,
} from './verify-github-supabase-advisor-run.mjs'

const repository = 'haengjoo123/buril-lab'
const commitSha = 'a'.repeat(40)
const now = Date.parse('2026-08-25T12:00:00.000Z')
const repoRoot = resolve(import.meta.dirname, '..')

function advisorRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    run_attempt: 1,
    name: 'Hosted Supabase advisor attestation',
    path: '.github/workflows/hosted-supabase-advisor.yml',
    display_title: `Hosted Supabase advisor staging ${commitSha}`,
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: commitSha,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-25T11:30:00.000Z',
    run_started_at: '2026-08-25T11:31:00.000Z',
    updated_at: '2026-08-25T11:35:00.000Z',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    ...overrides,
  }
}

describe('manual hosted Supabase Advisor workflow contract', () => {
  const workflow = readFileSync(
    resolve(repoRoot, '.github/workflows/hosted-supabase-advisor.yml'),
    'utf8',
  )
  const qualityWorkflow = readFileSync(
    resolve(repoRoot, '.github/workflows/quality.yml'),
    'utf8',
  )

  it('keeps automatic quality checks secret-free while retaining the static baseline', () => {
    expect(qualityWorkflow).toContain('run: npm run security:supabase-advisors')
    expect(qualityWorkflow).not.toContain('security:supabase-advisors:hosted')
    expect(qualityWorkflow).not.toContain('hosted-supabase-advisor:')
    expect(qualityWorkflow).not.toContain('SUPABASE_ACCESS_TOKEN')
    expect(qualityWorkflow).not.toContain('SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN')
  })

  it('allows only a supervised exact-main-SHA workflow dispatch', () => {
    expect(workflow).toMatch(/^on:\r?\n {2}workflow_dispatch:/m)
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|workflow_run|schedule):/m)
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'")
    expect(workflow).toContain("github.repository == 'haengjoo123/buril-lab'")
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain('if [[ "$DEPLOY_COMMIT_SHA" != "$GITHUB_SHA" ]]')
    expect(workflow).toContain('test "$(git rev-parse origin/main)" = "$DEPLOY_COMMIT_SHA"')
    expect(workflow).toContain('ref: ${{ inputs.commit_sha }}')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain(
      'ATTEST SUPABASE ADVISOR $ADVISOR_ENVIRONMENT $DEPLOY_COMMIT_SHA WITH EPHEMERAL TOKEN',
    )
  })

  it('selects one GitHub environment and maps the ephemeral PAT only on the verifier step', () => {
    expect(workflow).toContain('type: choice')
    expect(workflow).toContain('          - staging')
    expect(workflow).toContain('          - production')
    expect(workflow).toContain('name: ${{ inputs.environment }}')
    expect(workflow).toContain('SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}')
    expect(workflow).toContain('node scripts/verify-github-quality-run.mjs')
    expect(workflow).toContain(
      'test "$(node node_modules/supabase/dist/supabase.js --version)" = "2.115.0"',
    )

    const verifierStepStart = workflow.indexOf(
      '      - name: Fail closed on hosted advisor or permission drift',
    )
    const verifierStepEnd = workflow.indexOf(
      '      - name: Record public-safe attestation evidence',
      verifierStepStart,
    )
    expect(verifierStepStart).toBeGreaterThan(0)
    expect(verifierStepEnd).toBeGreaterThan(verifierStepStart)
    const beforeVerifier = workflow.slice(0, verifierStepStart)
    const verifierStep = workflow.slice(verifierStepStart, verifierStepEnd)
    expect(beforeVerifier).not.toContain('SUPABASE_ACCESS_TOKEN')
    expect(beforeVerifier).not.toContain('SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN')
    expect(verifierStep).toContain(
      'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN }}',
    )
    expect(workflow.match(/^\s*SUPABASE_ACCESS_TOKEN:/gm)).toHaveLength(1)
    expect(workflow.match(/\$\{\{ secrets\.SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN \}\}/g))
      .toHaveLength(1)
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('remove SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN')
    expect(workflow).toContain('revoke the token in Supabase')
  })
})

describe('GitHub Supabase Advisor attestation selection', () => {
  it('accepts a fresh successful exact-SHA and exact-environment run', () => {
    expect(findTrustedSupabaseAdvisorRun([advisorRun()], {
      repository,
      commitSha,
      environment: 'staging',
      now,
    })).toMatchObject({ id: 101, conclusion: 'success' })
  })

  it('does not let an older success hide a newer failed or running attestation', () => {
    const olderSuccess = advisorRun({
      id: 100,
      created_at: '2026-08-25T10:00:00.000Z',
      run_started_at: '2026-08-25T10:01:00.000Z',
      updated_at: '2026-08-25T10:05:00.000Z',
    })
    const newerFailure = advisorRun({
      id: 102,
      conclusion: 'failure',
      created_at: '2026-08-25T11:40:00.000Z',
      run_started_at: '2026-08-25T11:41:00.000Z',
      updated_at: '2026-08-25T11:45:00.000Z',
    })
    expect(() => findTrustedSupabaseAdvisorRun([olderSuccess, newerFailure], {
      repository,
      commitSha,
      environment: 'staging',
      now,
    })).toThrow('not completed successfully')

    newerFailure.status = 'in_progress'
    newerFailure.conclusion = null
    expect(() => findTrustedSupabaseAdvisorRun([olderSuccess, newerFailure], {
      repository,
      commitSha,
      environment: 'staging',
      now,
    })).toThrow('not completed successfully')
  })

  it('rejects cross-environment, cross-repository, wrong-workflow, and wrong-SHA runs', () => {
    const candidates = [
      advisorRun({ display_title: `Hosted Supabase advisor production ${commitSha}` }),
      advisorRun({ repository: { full_name: 'attacker/fork' } }),
      advisorRun({ path: '.github/workflows/quality.yml' }),
      advisorRun({ head_sha: 'b'.repeat(40) }),
      advisorRun({ event: 'push' }),
    ]
    expect(() => findTrustedSupabaseAdvisorRun(candidates, {
      repository,
      commitSha,
      environment: 'staging',
      now,
    })).toThrow('No trusted staging')
  })

  it('rejects stale, future, inconsistent, and malformed run evidence', () => {
    const staleTime = new Date(now - SUPABASE_ADVISOR_RUN_MAX_AGE_MS - 1).toISOString()
    expect(() => findTrustedSupabaseAdvisorRun([advisorRun({
      created_at: staleTime,
      run_started_at: staleTime,
      updated_at: staleTime,
    })], { repository, commitSha, environment: 'staging', now })).toThrow('older than 24 hours')

    expect(() => findTrustedSupabaseAdvisorRun([advisorRun({
      updated_at: '2026-08-25T12:06:00.000Z',
    })], { repository, commitSha, environment: 'staging', now })).toThrow('future timestamp')

    expect(() => findTrustedSupabaseAdvisorRun([advisorRun({
      run_started_at: '2026-08-25T11:36:00.000Z',
      updated_at: '2026-08-25T11:35:00.000Z',
    })], { repository, commitSha, environment: 'staging', now })).toThrow('timestamps are inconsistent')

    expect(() => findTrustedSupabaseAdvisorRun([advisorRun({ id: 0 })], {
      repository,
      commitSha,
      environment: 'staging',
      now,
    })).toThrow('invalid run id')
  })
})

describe('GitHub Supabase Advisor attestation lookup', () => {
  it('uses a bounded no-redirect GitHub lookup and exact trusted inputs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      workflow_runs: [advisorRun()],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }))

    const run = await fetchTrustedSupabaseAdvisorRun({
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: repository,
      DEPLOY_COMMIT_SHA: commitSha,
      DEPLOY_ENVIRONMENT: 'staging',
    }, { now, fetchImpl })

    expect(run.id).toBe(101)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [endpoint, init] = fetchImpl.mock.calls[0]
    expect(endpoint).toBeInstanceOf(URL)
    expect((endpoint as URL).origin).toBe('https://api.github.com')
    expect((endpoint as URL).pathname).toBe(
      '/repos/haengjoo123/buril-lab/actions/workflows/hosted-supabase-advisor.yml/runs',
    )
    expect((endpoint as URL).searchParams.get('branch')).toBe('main')
    expect((endpoint as URL).searchParams.get('event')).toBe('workflow_dispatch')
    expect((endpoint as URL).searchParams.get('head_sha')).toBe(commitSha)
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' })
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  it('fails closed on missing inputs, untrusted repository, bad environment, or non-JSON', async () => {
    await expect(fetchTrustedSupabaseAdvisorRun({}, { now, fetchImpl: vi.fn() }))
      .rejects.toThrow('inputs are missing')
    await expect(fetchTrustedSupabaseAdvisorRun({
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'attacker/fork',
      DEPLOY_COMMIT_SHA: commitSha,
      DEPLOY_ENVIRONMENT: 'staging',
    }, { now, fetchImpl: vi.fn() })).rejects.toThrow('not the trusted')
    await expect(fetchTrustedSupabaseAdvisorRun({
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: repository,
      DEPLOY_COMMIT_SHA: commitSha,
      DEPLOY_ENVIRONMENT: 'preview',
    }, { now, fetchImpl: vi.fn() })).rejects.toThrow('staging or production')

    const textResponse = vi.fn(async () => new Response('not json', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
    await expect(fetchTrustedSupabaseAdvisorRun({
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: repository,
      DEPLOY_COMMIT_SHA: commitSha,
      DEPLOY_ENVIRONMENT: 'staging',
    }, { now, fetchImpl: textResponse })).rejects.toThrow('is not JSON')
  })
})
