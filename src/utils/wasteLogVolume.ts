import type { WasteLogRecord } from '../services/wasteLogService';

/**
 * Volume in mL that one waste log contributes to a total. Voided records,
 * mass-only amounts and unknown amounts contribute nothing.
 */
export function getWasteLogVolumeMl(log: WasteLogRecord): number {
  if (log.voided_at) return 0;
  if (log.schema_version === 2) {
    if (log.amount_is_unknown) return 0;
    if (log.normalized_amount_unit === 'mL' && typeof log.normalized_amount_value === 'number') {
      return log.normalized_amount_value;
    }
    if (log.normalized_amount_unit) return 0;
  }
  return typeof log.total_volume_ml === 'number' ? log.total_volume_ml : 0;
}

/** Whether a live record has no volume to add: its amount is unknown or recorded by mass. */
export function hasNoWasteLogVolume(log: WasteLogRecord): boolean {
  if (log.voided_at) return false;
  if (log.schema_version === 2) {
    if (log.amount_is_unknown) return true;
    if (log.normalized_amount_unit === 'mL') return typeof log.normalized_amount_value !== 'number';
    if (log.normalized_amount_unit) return true;
  }
  return typeof log.total_volume_ml !== 'number';
}
