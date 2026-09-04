import { createClient } from '@supabase/supabase-js'
import { isUuid } from '../../_shared/validation'

export type DeletionStage = 'queued' | 'database' | 'storage' | 'auth' | 'finalize'
export type DeletionKind = 'account' | 'lab'

export interface ClaimedDeletionJob {
  jobId: string
  kind: DeletionKind
  subjectUserId: string | null
  labId: string | null
  stage: DeletionStage
  attemptCount: number
  leaseToken: string
}

export interface DeletionFileTarget {
  bucket: 'cabinets' | 'safety-center-verifications'
  path: string
}

export interface DeletionProcessorSummary {
  claimed: number
  completed: number
  pending: number
  failed: number
}

export interface DeletionProcessorGateway {
  acquireRun: (runToken: string) => Promise<boolean>
  releaseRun: (runToken: string) => Promise<void>
  claimJobs: () => Promise<ClaimedDeletionJob[]>
  prepareDatabase: (job: ClaimedDeletionJob) => Promise<DeletionStage>
  listFileTargets: (job: ClaimedDeletionJob) => Promise<DeletionFileTarget[]>
  deleteFiles: (targets: DeletionFileTarget[]) => Promise<void>
  markStorageComplete: (job: ClaimedDeletionJob) => Promise<DeletionStage>
  deleteAuthUser: (userId: string) => Promise<void>
  markAuthComplete: (job: ClaimedDeletionJob) => Promise<DeletionStage>
  finalizeJob: (job: ClaimedDeletionJob) => Promise<void>
  scheduleRetry: (job: ClaimedDeletionJob, errorCode: string) => Promise<'retry_wait' | 'failed' | 'completed'>
}

type RpcResult = { data: unknown; error: unknown }
type AdminClient = ReturnType<typeof createClient>

const ALLOWED_STAGES = new Set<DeletionStage>(['queued', 'database', 'storage', 'auth', 'finalize'])
const ALLOWED_BUCKETS = new Set<DeletionFileTarget['bucket']>(['cabinets', 'safety-center-verifications'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireSuccess(value: unknown, label: string): Record<string, unknown> {
  const result = record(value)
  if (!result || result.success !== true) throw new Error(`${label}_invalid`)
  return result
}

function requireStage(value: unknown, label: string): DeletionStage {
  const result = requireSuccess(value, label)
  if (typeof result.stage !== 'string' || !ALLOWED_STAGES.has(result.stage as DeletionStage)) {
    throw new Error(`${label}_stage_invalid`)
  }
  return result.stage as DeletionStage
}

function parseClaim(value: unknown): ClaimedDeletionJob {
  const row = record(value)
  if (!row || !isUuid(row.job_id) || !isUuid(row.lease_token)
    || (row.kind !== 'account' && row.kind !== 'lab')
    || typeof row.stage !== 'string' || !ALLOWED_STAGES.has(row.stage as DeletionStage)
    || !Number.isInteger(row.attempt_count) || Number(row.attempt_count) < 1 || Number(row.attempt_count) > 12) {
    throw new Error('deletion_claim_invalid')
  }
  const subjectUserId = row.subject_user_id === null ? null : String(row.subject_user_id)
  const labId = row.lab_id === null ? null : String(row.lab_id)
  if ((subjectUserId !== null && !isUuid(subjectUserId)) || (labId !== null && !isUuid(labId))
    || (row.kind === 'account' && (subjectUserId === null || labId !== null))
    || (row.kind === 'lab' && (subjectUserId !== null || labId === null))) {
    throw new Error('deletion_claim_scope_invalid')
  }
  return {
    jobId: String(row.job_id).toLowerCase(),
    kind: row.kind,
    subjectUserId: subjectUserId?.toLowerCase() ?? null,
    labId: labId?.toLowerCase() ?? null,
    stage: row.stage as DeletionStage,
    attemptCount: Number(row.attempt_count),
    leaseToken: String(row.lease_token).toLowerCase(),
  }
}

function parseTargets(value: unknown): DeletionFileTarget[] {
  const result = requireSuccess(value, 'deletion_targets')
  if (!Array.isArray(result.targets) || result.targets.length > 5000) {
    throw new Error('deletion_targets_invalid')
  }
  return result.targets.map((entry) => {
    const target = record(entry)
    if (!target || typeof target.bucket !== 'string' || !ALLOWED_BUCKETS.has(target.bucket as DeletionFileTarget['bucket'])
      || typeof target.path !== 'string' || target.path.length < 1 || new TextEncoder().encode(target.path).byteLength > 1024
      || Array.from(target.path).some((character) => {
        const code = character.charCodeAt(0)
        return code <= 31 || code === 127
      })) {
      throw new Error('deletion_target_invalid')
    }
    return { bucket: target.bucket as DeletionFileTarget['bucket'], path: target.path }
  })
}

async function rpc(admin: AdminClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await admin.rpc(name, args) as RpcResult
  if (error) throw new Error(`${name}_failed`)
  return data
}

export function createDeletionProcessorGateway(admin: AdminClient): DeletionProcessorGateway {
  return {
    acquireRun: async (runToken) => {
      const result = requireSuccess(await rpc(admin, 'acquire_deletion_worker_run_v1', {
        p_lease_token: runToken, p_lease_seconds: 55,
      }), 'deletion_run_acquire')
      if (typeof result.acquired !== 'boolean') throw new Error('deletion_run_acquire_invalid')
      return result.acquired
    },
    releaseRun: async (runToken) => {
      const result = requireSuccess(await rpc(admin, 'release_deletion_worker_run_v1', {
        p_lease_token: runToken,
      }), 'deletion_run_release')
      if (result.released !== true) throw new Error('deletion_run_release_invalid')
    },
    claimJobs: async () => {
      const result = requireSuccess(await rpc(admin, 'claim_deletion_jobs_v1', { p_limit: 1 }), 'deletion_claim')
      if (!Array.isArray(result.jobs) || result.jobs.length > 1) throw new Error('deletion_claim_invalid')
      return result.jobs.map(parseClaim)
    },
    prepareDatabase: async (job) => requireStage(await rpc(admin, 'prepare_deletion_job_database_v1', {
      p_job_id: job.jobId, p_lease_token: job.leaseToken,
    }), 'deletion_database'),
    listFileTargets: async (job) => parseTargets(await rpc(admin, 'list_deletion_file_targets_v1', {
      p_job_id: job.jobId, p_lease_token: job.leaseToken,
    })),
    deleteFiles: async (targets) => {
      const byBucket = new Map<DeletionFileTarget['bucket'], string[]>()
      for (const target of targets) {
        const paths = byBucket.get(target.bucket) ?? []
        paths.push(target.path)
        byBucket.set(target.bucket, paths)
      }
      for (const [bucket, paths] of byBucket) {
        for (let offset = 0; offset < paths.length; offset += 100) {
          const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
          if (error) throw new Error('deletion_storage_remove_failed')
        }
      }
    },
    markStorageComplete: async (job) => requireStage(await rpc(admin, 'mark_deletion_storage_complete_v1', {
      p_job_id: job.jobId, p_lease_token: job.leaseToken,
    }), 'deletion_storage_complete'),
    deleteAuthUser: async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId, false)
      if (error && error.status !== 404 && error.code !== 'user_not_found') {
        throw new Error('deletion_auth_remove_failed')
      }
    },
    markAuthComplete: async (job) => requireStage(await rpc(admin, 'mark_deletion_auth_complete_v1', {
      p_job_id: job.jobId, p_lease_token: job.leaseToken,
    }), 'deletion_auth_complete'),
    finalizeJob: async (job) => {
      const result = requireSuccess(await rpc(admin, 'finalize_deletion_job_v1', {
        p_job_id: job.jobId, p_lease_token: job.leaseToken,
      }), 'deletion_finalize')
      if (result.status !== 'completed') throw new Error('deletion_finalize_invalid')
    },
    scheduleRetry: async (job, errorCode) => {
      const result = requireSuccess(await rpc(admin, 'schedule_deletion_job_retry_v1', {
        p_job_id: job.jobId, p_lease_token: job.leaseToken, p_error_code: errorCode,
      }), 'deletion_retry')
      if (result.status !== 'retry_wait' && result.status !== 'failed' && result.status !== 'completed') {
        throw new Error('deletion_retry_invalid')
      }
      return result.status
    },
  }
}

function stageErrorCode(stage: DeletionStage): string {
  switch (stage) {
    case 'queued':
    case 'database': return 'DATABASE_STAGE_FAILED'
    case 'storage': return 'STORAGE_STAGE_FAILED'
    case 'auth': return 'AUTH_STAGE_FAILED'
    case 'finalize': return 'FINALIZE_STAGE_FAILED'
  }
}

async function processClaim(gateway: DeletionProcessorGateway, job: ClaimedDeletionJob): Promise<'completed' | 'pending' | 'failed'> {
  let stage = job.stage
  try {
    if (stage === 'queued' || stage === 'database') stage = await gateway.prepareDatabase(job)
    if (stage === 'storage') {
      await gateway.deleteFiles(await gateway.listFileTargets(job))
      stage = await gateway.markStorageComplete(job)
    }
    if (stage === 'auth') {
      if (job.kind === 'account') {
        if (!job.subjectUserId) throw new Error('deletion_subject_missing')
        await gateway.deleteAuthUser(job.subjectUserId)
      }
      stage = await gateway.markAuthComplete(job)
    }
    if (stage !== 'finalize') throw new Error('deletion_stage_invalid')
    await gateway.finalizeJob(job)
    return 'completed'
  } catch {
    const status = await gateway.scheduleRetry(job, stageErrorCode(stage))
    if (status === 'completed') return 'completed'
    return status === 'failed' ? 'failed' : 'pending'
  }
}

export async function runDeletionProcessor(gateway: DeletionProcessorGateway): Promise<DeletionProcessorSummary> {
  const summary: DeletionProcessorSummary = { claimed: 0, completed: 0, pending: 0, failed: 0 }
  const runToken = crypto.randomUUID()
  if (!await gateway.acquireRun(runToken)) return summary
  try {
    const jobs = await gateway.claimJobs()
    summary.claimed = jobs.length
    for (const job of jobs) {
      try {
        const outcome = await processClaim(gateway, job)
        summary[outcome] += 1
      } catch {
        summary.failed += 1
      }
    }
    return summary
  } finally {
    await gateway.releaseRun(runToken)
  }
}
