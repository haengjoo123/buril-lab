export type SafetyCenterStatus = 'pending' | 'approved' | 'rejected';
export type SafetyCenterRole = 'owner' | 'manager' | 'viewer';
export type SafetyCenterLabLinkStatus = 'requested' | 'approved' | 'rejected' | 'revoked' | null;
export type SafetyCenterRequestPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SafetyCenterRequestStatus = 'open' | 'in_progress' | 'submitted' | 'resolved';
export type SafetyCenterExportFormat = 'xlsx' | 'pdf';
export type SafetyCenterGhsDataStatus = 'success' | 'not_found' | 'no_ghs' | 'transient_error' | null;

export interface SafetyCenter {
  id: string;
  institution_name: string;
  institution_domain: string;
  center_name: string;
  status: SafetyCenterStatus;
  created_by: string;
  approved_at: string | null;
  created_at: string;
  member_role: SafetyCenterRole;
}

export interface SafetyCenterMember {
  id: string;
  center_id: string;
  user_id: string;
  role: SafetyCenterRole;
  joined_at: string;
}

export interface SafetyCenterLabCandidate {
  lab_id: string;
  lab_name: string;
  institution_name: string | null;
  institution_type: string | null;
  research_field: string | null;
  created_at: string;
  link_id: string | null;
  link_status: SafetyCenterLabLinkStatus;
  link_scope: string[] | null;
  requested_at: string | null;
  responded_at: string | null;
}

export interface LabSafetyCenterLinkRequest {
  link_id: string;
  center_id: string;
  center_name: string;
  institution_name: string;
  institution_domain: string;
  center_status: SafetyCenterStatus;
  link_status: Exclude<SafetyCenterLabLinkStatus, null>;
  link_scope: string[];
  requested_at: string;
  responded_at: string | null;
}

export interface SafetyCenterRiskItem {
  source_type: 'inventory' | 'cabinet_item';
  item_id: string;
  lab_id: string;
  lab_name: string;
  inventory_name: string;
  brand: string | null;
  product_number: string | null;
  cas_number: string | null;
  quantity: number;
  capacity: string | null;
  storage_type: 'cabinet' | 'other';
  cabinet_name: string | null;
  storage_location_name: string | null;
  expiry_date: string | null;
  remaining_percent: number | null;
  /** Fresh lab-scoped GHS data returned by the Safety Center RPC when available. */
  ghs_h_codes?: string[] | null;
  ghs_data_status?: SafetyCenterGhsDataStatus;
  ghs_fetched_at?: string | null;
  ghs_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafetyCenterWasteLog {
  id: string;
  lab_id: string;
  lab_name: string;
  created_at: string;
  disposal_category: string;
  total_volume_ml: number | null;
  handler_name: string | null;
  memo: string | null;
  chemicals: unknown;
}

export interface SafetyCenterAuditLog {
  id: string;
  lab_id: string;
  lab_name: string;
  created_at: string;
  actor_name: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  location_context: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  diff_data: Record<string, unknown> | null;
  source: string | null;
}

export interface SafetyCenterRequest {
  id: string;
  center_id: string;
  lab_id: string;
  lab_name: string;
  target_type: string | null;
  target_id: string | null;
  title: string;
  description: string | null;
  priority: SafetyCenterRequestPriority;
  status: SafetyCenterRequestStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LabSafetyCenterRequest {
  id: string;
  center_id: string;
  center_name: string;
  lab_id: string;
  target_type: string | null;
  target_id: string | null;
  title: string;
  description: string | null;
  priority: SafetyCenterRequestPriority;
  status: SafetyCenterRequestStatus;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafetyCenterRequestEvent {
  id: string;
  request_id: string;
  actor_user_id: string | null;
  actor_scope: 'center' | 'lab' | 'system';
  event_type: 'created' | 'comment' | 'status_change';
  from_status: SafetyCenterRequestStatus | null;
  to_status: SafetyCenterRequestStatus | null;
  body: string | null;
  created_at: string;
}

export interface SafetyCenterExportLog {
  id: string;
  center_id: string;
  user_id: string;
  format: SafetyCenterExportFormat;
  datasets: string[];
  lab_ids: string[];
  filters: Record<string, unknown>;
  row_count: number;
  created_at: string;
}
