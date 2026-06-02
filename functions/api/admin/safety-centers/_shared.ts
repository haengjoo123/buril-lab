import { json, requireFeedbackAdmin, type FeedbackAdminEnv } from '../feedback/_shared'

export type SafetyCenterAdminEnv = FeedbackAdminEnv

export interface SafetyCenterAdminRow {
  id: string
  institution_name: string
  institution_domain: string
  center_name: string
  status: 'pending' | 'approved' | 'rejected'
  created_by: string
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export const SAFETY_CENTER_SELECT_FIELDS = [
  'id',
  'institution_name',
  'institution_domain',
  'center_name',
  'status',
  'created_by',
  'approved_by',
  'approved_at',
  'created_at',
  'updated_at',
].join(', ')

export { json, requireFeedbackAdmin }

