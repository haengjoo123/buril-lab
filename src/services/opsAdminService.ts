import { supabase } from './supabaseClient'
import { getInternalApiUrl } from './apiUrl'
import type { SafetyCenterStatus } from '../features/safety-center/types'

export class OpsAdminApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'OpsAdminApiError'
    this.status = status
  }
}

export interface SafetyCenterApprovalItem {
  id: string
  institution_name: string
  institution_domain: string
  center_name: string
  status: SafetyCenterStatus
  created_by: string
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

interface ApiErrorPayload {
  error?: string
}

interface SafetyCenterListResponse {
  items: SafetyCenterApprovalItem[]
}

interface SafetyCenterStatusResponse {
  item: SafetyCenterApprovalItem
}

async function createAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  return headers
}

async function parseApiError(response: Response): Promise<OpsAdminApiError> {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await response.json() as ApiErrorPayload
    return new OpsAdminApiError(
      payload.error || `Request failed with status ${response.status}`,
      response.status,
    )
  }

  const text = await response.text()
  return new OpsAdminApiError(text || `Request failed with status ${response.status}`, response.status)
}

async function postOpsAdminJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(getInternalApiUrl(path), {
    method: 'POST',
    headers: await createAuthHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await parseApiError(response)
  }

  return await response.json() as TResponse
}

export async function listSafetyCenterApprovals(): Promise<SafetyCenterApprovalItem[]> {
  const payload = await postOpsAdminJson<SafetyCenterListResponse>('/api/admin/safety-centers/list', {})
  return payload.items
}

export async function updateSafetyCenterApprovalStatus(
  centerId: string,
  status: SafetyCenterStatus,
): Promise<SafetyCenterApprovalItem> {
  const payload = await postOpsAdminJson<SafetyCenterStatusResponse>('/api/admin/safety-centers/status', {
    centerId,
    status,
  })

  return payload.item
}

