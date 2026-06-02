import { supabase } from './supabaseClient';
import type {
  LabSafetyCenterLinkRequest,
  LabSafetyCenterRequest,
  SafetyCenter,
  SafetyCenterAuditLog,
  SafetyCenterExportFormat,
  SafetyCenterExportLog,
  SafetyCenterLabCandidate,
  SafetyCenterMember,
  SafetyCenterRequest,
  SafetyCenterRequestEvent,
  SafetyCenterRequestPriority,
  SafetyCenterRequestStatus,
  SafetyCenterRiskItem,
  SafetyCenterWasteLog,
} from '../features/safety-center/types';

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

function isMissingSafetyCenterSchema(error: unknown): boolean {
  const err = error as SupabaseLikeError | null | undefined;
  const message = [err?.message, err?.details].filter(Boolean).join('\n');
  return (
    err?.code === 'PGRST202' ||
    err?.code === '42883' ||
    err?.code === '42P01' ||
    message.includes('Could not find the function')
  );
}

function throwUnlessMissingSchema(error: unknown): void {
  if (isMissingSafetyCenterSchema(error)) return;
  throw error;
}

export interface CreateSafetyCenterInput {
  institutionName: string;
  institutionDomain: string;
  centerName: string;
}

export interface CreateSafetyCenterRequestInput {
  centerId: string;
  labId: string;
  title: string;
  description?: string;
  priority?: SafetyCenterRequestPriority;
  dueDate?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}

export interface LogSafetyCenterExportInput {
  centerId: string;
  format: SafetyCenterExportFormat;
  datasets: string[];
  labIds: string[];
  filters: Record<string, unknown>;
  rowCount: number;
}

export const safetyCenterService = {
  async getMyCenters(): Promise<SafetyCenter[]> {
    const { data, error } = await supabase.rpc('get_my_safety_centers');
    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }
    return (data ?? []) as SafetyCenter[];
  },

  async createCenter(input: CreateSafetyCenterInput): Promise<string> {
    const { data, error } = await supabase.rpc('create_safety_center', {
      p_institution_name: input.institutionName,
      p_institution_domain: input.institutionDomain,
      p_center_name: input.centerName,
    });

    if (error) throw error;
    return data as string;
  },

  async getCenterMembers(centerId: string): Promise<SafetyCenterMember[]> {
    const { data, error } = await supabase
      .from('safety_center_members')
      .select('*')
      .eq('center_id', centerId)
      .order('joined_at', { ascending: true });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterMember[];
  },

  async getLabCandidates(centerId: string, search = ''): Promise<SafetyCenterLabCandidate[]> {
    const { data, error } = await supabase.rpc('get_safety_center_lab_candidates', {
      p_center_id: centerId,
      p_search: search,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterLabCandidate[];
  },

  async requestLabLink(centerId: string, labId: string, scope = ['summary', 'risk_detail', 'exports']): Promise<string> {
    const { data, error } = await supabase.rpc('request_safety_center_lab_link', {
      p_center_id: centerId,
      p_lab_id: labId,
      p_scope: scope,
    });

    if (error) throw error;
    return data as string;
  },

  async getLabLinkRequests(labId: string): Promise<LabSafetyCenterLinkRequest[]> {
    const { data, error } = await supabase.rpc('get_lab_safety_center_link_requests', {
      p_lab_id: labId,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as LabSafetyCenterLinkRequest[];
  },

  async respondLabLink(linkId: string, status: 'approved' | 'rejected' | 'revoked'): Promise<void> {
    const { error } = await supabase.rpc('respond_safety_center_lab_link', {
      p_link_id: linkId,
      p_status: status,
    });

    if (error) throw error;
  },

  async getRiskItems(centerId: string): Promise<SafetyCenterRiskItem[]> {
    const { data, error } = await supabase.rpc('get_safety_center_risk_items', {
      p_center_id: centerId,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterRiskItem[];
  },

  async getWasteLogs(centerId: string, createdAfter?: string | null, createdBefore?: string | null): Promise<SafetyCenterWasteLog[]> {
    const { data, error } = await supabase.rpc('get_safety_center_waste_logs', {
      p_center_id: centerId,
      p_created_after: createdAfter ?? null,
      p_created_before: createdBefore ?? null,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterWasteLog[];
  },

  async getAuditLogs(centerId: string, limit = 100): Promise<SafetyCenterAuditLog[]> {
    const { data, error } = await supabase.rpc('get_safety_center_audit_logs', {
      p_center_id: centerId,
      p_limit: limit,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterAuditLog[];
  },

  async getRequests(centerId: string): Promise<SafetyCenterRequest[]> {
    const { data, error } = await supabase.rpc('get_safety_center_requests', {
      p_center_id: centerId,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterRequest[];
  },

  async getLabRequests(labId: string): Promise<LabSafetyCenterRequest[]> {
    const { data, error } = await supabase.rpc('get_lab_safety_center_requests', {
      p_lab_id: labId,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as LabSafetyCenterRequest[];
  },

  async createRequest(input: CreateSafetyCenterRequestInput): Promise<string> {
    const { data, error } = await supabase.rpc('create_safety_center_request', {
      p_center_id: input.centerId,
      p_lab_id: input.labId,
      p_title: input.title,
      p_description: input.description ?? null,
      p_priority: input.priority ?? 'normal',
      p_due_date: input.dueDate ?? null,
      p_target_type: input.targetType ?? null,
      p_target_id: input.targetId ?? null,
    });

    if (error) throw error;
    return data as string;
  },

  async addRequestEvent(requestId: string, body?: string, nextStatus?: SafetyCenterRequestStatus): Promise<void> {
    const { error } = await supabase.rpc('add_safety_center_request_event', {
      p_request_id: requestId,
      p_body: body ?? null,
      p_to_status: nextStatus ?? null,
    });

    if (error) throw error;
  },

  async getRequestEvents(requestId: string): Promise<SafetyCenterRequestEvent[]> {
    const { data, error } = await supabase
      .from('safety_center_request_events')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterRequestEvent[];
  },

  async logExport(input: LogSafetyCenterExportInput): Promise<string | null> {
    const { data, error } = await supabase.rpc('log_safety_center_export', {
      p_center_id: input.centerId,
      p_format: input.format,
      p_datasets: input.datasets,
      p_lab_ids: input.labIds,
      p_filters: input.filters,
      p_row_count: input.rowCount,
    });

    if (error) {
      throwUnlessMissingSchema(error);
      return null;
    }

    return data as string;
  },

  async getExportLogs(centerId: string): Promise<SafetyCenterExportLog[]> {
    const { data, error } = await supabase
      .from('safety_center_exports')
      .select('*')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throwUnlessMissingSchema(error);
      return [];
    }

    return (data ?? []) as SafetyCenterExportLog[];
  },
};
