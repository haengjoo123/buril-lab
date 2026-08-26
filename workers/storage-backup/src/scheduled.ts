import {
  runScheduledBackup,
  type BackupRunResult,
  type StorageBackupBindings,
} from './storageBackup'

type BackupRunner = (bindings: StorageBackupBindings) => Promise<BackupRunResult>

export async function runStorageBackupSchedule(
  bindings: StorageBackupBindings,
  runner: BackupRunner = runScheduledBackup,
): Promise<void> {
  let result: BackupRunResult
  try {
    result = await runner(bindings)
  } catch {
    throw new Error('storage_backup_failed:unexpected_failure')
  }

  if (result.status === 'failed') {
    throw new Error(`storage_backup_failed:${result.code}`)
  }
}
