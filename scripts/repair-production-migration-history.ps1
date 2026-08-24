[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('plan', 'apply', 'restore-legacy')]
  [string] $Mode,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z]{20}$')]
  [string] $ProjectRef,

  [string] $Confirmation = '',

  [string] $EvidencePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$baselineVersion = '20260824000000'
$expectedLegacyCount = 89
$expectedLegacyHistorySha256 = 'ff169071822bd12de18c5485473e000aa50ad092ec6544fab25d045a471b113b'
$expectedSnapshotSha256 = 'c72f031e8d459e2db425352d9f97daadecada97e3f0c57060fe2b57217a964d6'
$expectedSupabaseCliVersion = '2.115.0'
$snapshotPath = Join-Path $PSScriptRoot '..\supabase\legacy_migrations\application-history-before-baseline.json'

function Get-TextSha256 {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text)

  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $digest = [Security.Cryptography.SHA256]::HashData($bytes)
  return [Convert]::ToHexString($digest).ToLowerInvariant()
}

function Get-HistorySha256 {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Versions)

  $canonical = [string]::Join("`n", @($Versions | Sort-Object -Unique))
  return Get-TextSha256 -Text $canonical
}

function Get-SnapshotSha256 {
  param([Parameter(Mandatory = $true)] $Snapshot)

  $canonicalLines = [Collections.Generic.List[string]]::new()
  $capturedAt = if ($Snapshot.captured_at -is [DateTime]) {
    $Snapshot.captured_at.ToUniversalTime().ToString(
      'yyyy-MM-ddTHH:mm:ss.fffffffZ',
      [Globalization.CultureInfo]::InvariantCulture
    )
  } else {
    [string]$Snapshot.captured_at
  }
  $canonicalLines.Add($capturedAt)
  $canonicalLines.Add([string]$Snapshot.production_project_ref)
  $canonicalLines.Add([string]$Snapshot.note)

  foreach ($row in @($Snapshot.migrations)) {
    $canonicalLines.Add(
      ([string]$row.local) + '|' + ([string]$row.remote) + '|' + ([string]$row.time)
    )
  }

  return Get-TextSha256 -Text ([string]::Join("`n", $canonicalLines))
}

function Test-ExactVersionSet {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Actual,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Expected
  )

  $actualSorted = @($Actual | Sort-Object -Unique)
  $expectedSorted = @($Expected | Sort-Object -Unique)
  if ($actualSorted.Count -ne $expectedSorted.Count) {
    return $false
  }

  return @(
    Compare-Object -ReferenceObject $expectedSorted -DifferenceObject $actualSorted
  ).Count -eq 0
}

function Get-DatabasePassword {
  $password = [Environment]::GetEnvironmentVariable('BURILLAB_PRODUCTION_DB_PASSWORD', 'Process')
  if ([string]::IsNullOrWhiteSpace($password)) {
    $password = [Environment]::GetEnvironmentVariable('BURILLAB_PRODUCTION_DB_PASSWORD', 'User')
  }

  if ([string]::IsNullOrWhiteSpace($password)) {
    throw 'BURILLAB_PRODUCTION_DB_PASSWORD is not set in the process or Windows user environment.'
  }

  return $password
}

function Invoke-SupabaseCliCaptured {
  param(
    [Parameter(Mandatory = $true)][string[]] $Arguments,
    [Parameter(Mandatory = $true)][string] $DatabasePassword
  )

  $stderrPath = [IO.Path]::GetTempFileName()
  $output = @()
  $exitCode = -1
  $invocationFailed = $false
  $previousSupabasePassword = [Environment]::GetEnvironmentVariable('SUPABASE_DB_PASSWORD', 'Process')

  try {
    # Supabase officially supports SUPABASE_DB_PASSWORD for non-interactive
    # execution. Do not put the password in argv, where local process viewers
    # and diagnostic tooling could capture it.
    [Environment]::SetEnvironmentVariable('SUPABASE_DB_PASSWORD', $DatabasePassword, 'Process')
    try {
      # Never let npx download an unreviewed CLI during a production-history
      # operation. Install the reviewed version before running this script.
      $output = @(& npx '--no-install' @Arguments 2> $stderrPath)
      $exitCode = $LASTEXITCODE
    } catch {
      $invocationFailed = $true
    }

    if ($invocationFailed -or $exitCode -ne 0) {
      $diagnostic = if (Test-Path -LiteralPath $stderrPath) {
        Get-Content -LiteralPath $stderrPath -Raw
      } else {
        ''
      }
      $fingerprint = Get-TextSha256 -Text ([string]$diagnostic)
      throw "Supabase CLI failed. Raw output was suppressed; diagnostic SHA-256: $fingerprint"
    }

    return ,$output
  } finally {
    [Environment]::SetEnvironmentVariable('SUPABASE_DB_PASSWORD', $previousSupabasePassword, 'Process')
    if (Test-Path -LiteralPath $stderrPath) {
      Remove-Item -LiteralPath $stderrPath -Force
    }
  }
}

function Assert-SupabaseCliVersion {
  param([Parameter(Mandatory = $true)][string] $DatabasePassword)

  $output = Invoke-SupabaseCliCaptured -Arguments @('supabase', '--version') -DatabasePassword $DatabasePassword
  $actual = ([string]::Join('', @($output))).Trim()
  if ($actual -cne $expectedSupabaseCliVersion) {
    $fingerprint = Get-TextSha256 -Text $actual
    throw "Supabase CLI version is not the reviewed version; output SHA-256: $fingerprint"
  }
}

function Get-RemoteMigrationVersions {
  param(
    [Parameter(Mandatory = $true)][string] $TargetProjectRef,
    [Parameter(Mandatory = $true)][string] $DatabasePassword
  )

  $arguments = @(
    'supabase', 'migration', 'list',
    '--project-ref', $TargetProjectRef,
    '--output-format', 'json'
  )
  $stdout = Invoke-SupabaseCliCaptured -Arguments $arguments -DatabasePassword $DatabasePassword
  $jsonText = [string]::Join([Environment]::NewLine, @($stdout | ForEach-Object { [string]$_ })).Trim()

  try {
    $payload = $jsonText | ConvertFrom-Json
  } catch {
    $fingerprint = Get-TextSha256 -Text $jsonText
    throw "Unable to parse Supabase migration-list JSON. Raw output was suppressed; output SHA-256: $fingerprint"
  }

  $rows = if ($payload -is [array]) {
    @($payload)
  } elseif ($null -ne $payload.PSObject.Properties['migrations']) {
    @($payload.migrations)
  } elseif ($null -ne $payload.PSObject.Properties['data']) {
    @($payload.data)
  } else {
    @($payload)
  }

  $versions = foreach ($row in $rows) {
    $remoteProperty = @(
      $row.PSObject.Properties |
        Where-Object { $_.Name -ieq 'remote' }
    ) | Select-Object -First 1
    if ($null -eq $remoteProperty) {
      continue
    }

    $remote = ([string]$remoteProperty.Value).Trim()
    if ([string]::IsNullOrWhiteSpace($remote)) {
      continue
    }
    if ($remote -notmatch '^\d{14}$') {
      throw 'The remote migration list contains a non-timestamp version; refusing repair.'
    }
    $remote
  }

  $versions = @($versions | Sort-Object)
  if (@($versions | Sort-Object -Unique).Count -ne $versions.Count) {
    throw 'The remote migration list contains duplicate versions; refusing repair.'
  }

  return ,$versions
}

function Invoke-MigrationRepair {
  param(
    [Parameter(Mandatory = $true)][string[]] $Versions,
    [Parameter(Mandatory = $true)][ValidateSet('applied', 'reverted')][string] $Status,
    [Parameter(Mandatory = $true)][string] $TargetProjectRef,
    [Parameter(Mandatory = $true)][string] $DatabasePassword
  )

  if ($Versions.Count -eq 0) {
    throw 'Refusing an empty migration repair operation.'
  }

  $arguments = @(
    'supabase', 'migration', 'repair'
  ) + @($Versions) + @(
    '--status', $Status,
    '--project-ref', $TargetProjectRef,
    '--yes'
  )

  [void](Invoke-SupabaseCliCaptured -Arguments $arguments -DatabasePassword $DatabasePassword)
}

function Get-HistoryState {
  param(
    [Parameter(Mandatory = $true)][string[]] $Actual,
    [Parameter(Mandatory = $true)][string[]] $Legacy,
    [Parameter(Mandatory = $true)][string[]] $Transition,
    [Parameter(Mandatory = $true)][string[]] $Baseline
  )

  if (Test-ExactVersionSet -Actual $Actual -Expected $Legacy) { return 'legacy' }
  if (Test-ExactVersionSet -Actual $Actual -Expected $Transition) { return 'transition' }
  if (Test-ExactVersionSet -Actual $Actual -Expected $Baseline) { return 'baseline' }
  return 'unknown'
}

function Assert-State {
  param(
    [Parameter(Mandatory = $true)][string] $Actual,
    [Parameter(Mandatory = $true)][string[]] $Allowed
  )

  if ($Actual -notin $Allowed) {
    throw "Remote migration history is not an exact approved state (actual: $Actual). No repair was attempted."
  }
}

function Write-SafeEvidence {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary] $Evidence)

  $json = $Evidence | ConvertTo-Json -Depth 5
  if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
    if (Test-Path -LiteralPath $EvidencePath) {
      throw 'EvidencePath already exists; refusing to overwrite evidence.'
    }
    $parent = Split-Path -Parent $EvidencePath
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Path $parent | Out-Null
    }
    [IO.File]::WriteAllText(
      [IO.Path]::GetFullPath($EvidencePath),
      $json + [Environment]::NewLine,
      [Text.UTF8Encoding]::new($false)
    )
  }

  Write-Output $json
}

$snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
if ((Get-SnapshotSha256 -Snapshot $snapshot) -cne $expectedSnapshotSha256) {
  throw 'The immutable production-history evidence snapshot differs from the reviewed snapshot.'
}
if ($snapshot.production_project_ref -cne $ProjectRef) {
  throw 'The requested project ref does not match the immutable production-history snapshot.'
}

$legacyVersions = @(
  $snapshot.migrations |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.remote) } |
    ForEach-Object { [string]$_.remote } |
    Sort-Object
)
if ($legacyVersions.Count -ne $expectedLegacyCount) {
  throw "The legacy snapshot must contain exactly $expectedLegacyCount remote versions."
}
if (@($legacyVersions | Sort-Object -Unique).Count -ne $expectedLegacyCount) {
  throw 'The legacy snapshot contains duplicate remote versions.'
}
if ($legacyVersions | Where-Object { $_ -notmatch '^\d{14}$' }) {
  throw 'The legacy snapshot contains an invalid migration version.'
}

$legacyHistorySha256 = Get-HistorySha256 -Versions $legacyVersions
if ($legacyHistorySha256 -cne $expectedLegacyHistorySha256) {
  throw 'The legacy 89-version snapshot differs from the reviewed production snapshot.'
}

$baselineVersions = @($baselineVersion)
$transitionVersions = @($legacyVersions + $baselineVersion | Sort-Object -Unique)
$databasePassword = Get-DatabasePassword
Assert-SupabaseCliVersion -DatabasePassword $databasePassword
$beforeVersions = Get-RemoteMigrationVersions -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
$beforeState = Get-HistoryState -Actual $beforeVersions -Legacy $legacyVersions -Transition $transitionVersions -Baseline $baselineVersions
$changed = $false

if ($Mode -eq 'plan') {
  Assert-State -Actual $beforeState -Allowed @('legacy', 'transition', 'baseline')
} elseif ($Mode -eq 'apply') {
  Assert-State -Actual $beforeState -Allowed @('legacy', 'transition', 'baseline')
  if ($beforeState -ne 'baseline') {
    $requiredConfirmation = "APPLY BASELINE $ProjectRef $legacyHistorySha256"
    if ($Confirmation -cne $requiredConfirmation) {
      throw "Confirmation must exactly match: $requiredConfirmation"
    }

    if ($beforeState -eq 'legacy') {
      Invoke-MigrationRepair -Versions $baselineVersions -Status 'applied' -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
      $transitionCheck = Get-RemoteMigrationVersions -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
      if (-not (Test-ExactVersionSet -Actual $transitionCheck -Expected $transitionVersions)) {
        throw 'Baseline marker was not added to the exact 89-version history; refusing the revert step.'
      }
    }

    Invoke-MigrationRepair -Versions $legacyVersions -Status 'reverted' -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
    $changed = $true
  }
} else {
  Assert-State -Actual $beforeState -Allowed @('legacy', 'transition', 'baseline')
  if ($beforeState -ne 'legacy') {
    $requiredConfirmation = "RESTORE LEGACY $ProjectRef $legacyHistorySha256"
    if ($Confirmation -cne $requiredConfirmation) {
      throw "Confirmation must exactly match: $requiredConfirmation"
    }

    if ($beforeState -eq 'baseline') {
      Invoke-MigrationRepair -Versions $legacyVersions -Status 'applied' -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
      $transitionCheck = Get-RemoteMigrationVersions -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
      if (-not (Test-ExactVersionSet -Actual $transitionCheck -Expected $transitionVersions)) {
        throw 'The exact 89-version history was not restored alongside the baseline; refusing the final step.'
      }
    }

    Invoke-MigrationRepair -Versions $baselineVersions -Status 'reverted' -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
    $changed = $true
  }
}

$afterVersions = if ($Mode -eq 'plan') {
  $beforeVersions
} else {
  Get-RemoteMigrationVersions -TargetProjectRef $ProjectRef -DatabasePassword $databasePassword
}
$afterState = Get-HistoryState -Actual $afterVersions -Legacy $legacyVersions -Transition $transitionVersions -Baseline $baselineVersions

if ($Mode -eq 'apply' -and $afterState -ne 'baseline') {
  throw 'Apply did not finish at the exact baseline-only history state.'
}
if ($Mode -eq 'restore-legacy' -and $afterState -ne 'legacy') {
  throw 'Restore did not finish at the exact reviewed 89-version history state.'
}

$recommendedMode = switch ($afterState) {
  'legacy' { 'apply' }
  'baseline' { 'none' }
  'transition' { 'apply-or-restore-legacy' }
  default { 'stop' }
}

Write-SafeEvidence -Evidence ([ordered]@{
  evidence_schema = 'burillab.migration-history-repair.v1'
  generated_at_utc = [DateTime]::UtcNow.ToString('o')
  operation = $Mode
  changed = $changed
  state_before = $beforeState
  state_after = $afterState
  recommended_mode = $recommendedMode
  baseline_version = $baselineVersion
  reviewed_legacy_count = $expectedLegacyCount
  reviewed_legacy_history_sha256 = $legacyHistorySha256
  reviewed_snapshot_sha256 = $expectedSnapshotSha256
  remote_count_before = $beforeVersions.Count
  remote_history_sha256_before = Get-HistorySha256 -Versions $beforeVersions
  remote_count_after = $afterVersions.Count
  remote_history_sha256_after = Get-HistorySha256 -Versions $afterVersions
  project_ref_sha256 = Get-TextSha256 -Text $ProjectRef
})
