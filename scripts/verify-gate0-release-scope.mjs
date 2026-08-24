import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_BASE_SHA = 'bf8dcc726061f0e89bc8fbf39e63e1db8e90e2b2'
const baseSha = process.env.GATE0_BASE_SHA?.trim() || DEFAULT_BASE_SHA

function fail(message) {
  throw new Error(`[gate0-scope] ${message}`)
}

function changedFiles() {
  try {
    return execFileSync('git', ['diff', '--name-only', `${baseSha}...HEAD`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  } catch (error) {
    fail(`cannot compare the release with ${baseSha}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const forbiddenChangedPathPatterns = [
  /^\.github\/workflows\/deploy-(?:storage-backup|deletion-scheduler)\.yml$/u,
  /^e2e\/(?:pilot-flow|public-release)\.spec\.ts$/u,
  /^functions\/_middleware(?:\.test)?\.ts$/u,
  /^functions\/api\/\[\[path\]\](?:\.test)?\.ts$/u,
  /^functions\/api\/_middleware/u,
  /^functions\/api\/admin\//u,
  /^functions\/api\/labs\//u,
  /^functions\/api\/maintenance\//u,
  /^functions\/api\/notifications\//u,
  /^functions\/api\/vision\/ocr\.ts$/u,
  /^functions\/api\/voice\/transcribe(?:\.test)?\.ts$/u,
  /^src\/config\/publicRelease/u,
  /^src\/components\/(?:ExpiryNotificationBell|PublicInformationView|PublicSupportContact)\.tsx$/u,
  /^src\/features\/ops\//u,
  /^src\/services\/(?:accountDeletion|expiryNotification|manufacturerSds|monthlySafetyReport)Service/u,
  /^src\/utils\/(?:barcodeScan|monthlySafetyReportExport|publicRoutes|voiceWasteDraft)/u,
  /^supabase\/deferred_migrations\//u,
  /^public\/_headers$/u,
  /^workers\//u,
]

for (const file of changedFiles()) {
  if (forbiddenChangedPathPatterns.some((pattern) => pattern.test(file))) {
    fail(`later-gate path is included in the Gate 0 release: ${file}`)
  }
}

const migrationDir = path.resolve('supabase/migrations')
if (existsSync(migrationDir)) {
  const migrationSql = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const expected = ['20260824000000_production_baseline.sql']
  if (JSON.stringify(migrationSql) !== JSON.stringify(expected)) {
    fail(`active migration set must contain only the baseline; found ${migrationSql.join(', ') || '(none)'}`)
  }
}

const voiceFiles = [
  'functions/api/voice/query.ts',
  'src/utils/voiceAgent.ts',
  'src/store/useVoiceAgentStore.ts',
].filter(existsSync)
const forbiddenVoiceTokens = [
  'guidedDisposal',
  'update_waste_batch_draft',
  'draftPatch',
  'decisionStatus',
  'componentCandidates',
]

for (const file of voiceFiles) {
  const source = readFileSync(file, 'utf8')
  for (const token of forbiddenVoiceTokens) {
    if (source.includes(token)) fail(`guided voice token ${token} is present in ${file}`)
  }
}

const voiceSource = voiceFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
if (!voiceSource.includes('open_waste_batch_review')) {
  fail('voice disposal redirect action is missing')
}

console.log(JSON.stringify({
  baseSha,
  activeMigrationCount: existsSync(migrationDir) ? 1 : 0,
  checkedVoiceFiles: voiceFiles.length,
  result: 'gate0-scope-ok',
}))
