import { supabase } from './supabaseClient'
import { getInternalApiUrl } from './apiUrl'

export interface TranscriptionResult {
  text: string
  language?: string
  durationMs?: number
  model: string
}

export type SpeechAudioFormat = 'mp3' | 'wav' | 'aac' | 'opus'

export interface SpeechResult {
  blob: Blob
  contentType: string
}

interface TranscriptionOptions {
  language?: string
  prompt?: string
}

interface SpeakOptions {
  voice?: string
  format?: SpeechAudioFormat
}

interface ApiErrorPayload {
  error?: string
}

async function createAuthHeaders(contentType?: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}

  if (contentType) {
    headers['Content-Type'] = contentType
  }

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  return headers
}

async function throwIfApiError(response: Response): Promise<void> {
  if (response.ok) return

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const payload = await response.json() as ApiErrorPayload
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }

  const text = await response.text()
  throw new Error(text || `Request failed with status ${response.status}`)
}

export async function transcribeAudio(
  file: File,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const formData = new FormData()
  formData.set('file', file)

  if (options.language) {
    formData.set('language', options.language)
  }

  if (options.prompt) {
    formData.set('prompt', options.prompt)
  }

  const headers = await createAuthHeaders()
  const response = await fetch(getInternalApiUrl('/api/voice/transcribe'), {
    method: 'POST',
    headers,
    body: formData,
  })

  await throwIfApiError(response)
  return await response.json() as TranscriptionResult
}

export async function speakText(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeechResult> {
  const headers = await createAuthHeaders('application/json')
  const response = await fetch(getInternalApiUrl('/api/voice/speak'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      voice: options.voice,
      format: options.format,
    }),
  })

  await throwIfApiError(response)

  return {
    blob: await response.blob(),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}
