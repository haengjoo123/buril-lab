import OpenAI from 'openai'

export interface VoiceEnv {
  OPENAI_API_KEY?: string
  OPENAI_STT_MODEL?: string
  OPENAI_TTS_MODEL?: string
  OPENAI_TTS_VOICE?: string
  OPENAI_AUDIO_ENABLED?: string
}

export type SpeechAudioFormat = 'mp3' | 'wav' | 'aac' | 'opus'

const DEFAULT_STT_MODEL = 'whisper-1'
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_TTS_VOICE = 'alloy'
const SUPPORTED_SPEECH_FORMATS = new Set<SpeechAudioFormat>(['mp3', 'wav', 'aac', 'opus'])

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}

export function isOpenAIAudioEnabled(env: VoiceEnv): boolean {
  return env.OPENAI_AUDIO_ENABLED?.trim().toLowerCase() === 'true' && Boolean(env.OPENAI_API_KEY?.trim())
}

export function openAIAudioDisabledResponse() {
  return json(
    {
      error: 'OpenAI audio feature is disabled.',
      code: 'feature_disabled',
    },
    { status: 503 },
  )
}

export function createOpenAIClient(env: VoiceEnv): OpenAI {
  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error('OpenAI API key is not configured.')
  }

  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  })
}

export function resolveSttModel(env: VoiceEnv): string {
  return env.OPENAI_STT_MODEL?.trim() || DEFAULT_STT_MODEL
}

export function resolveTtsModel(env: VoiceEnv): string {
  return env.OPENAI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL
}

export function resolveTtsVoice(env: VoiceEnv): string {
  return env.OPENAI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE
}

export function supportsVerboseTranscription(model: string): boolean {
  return model.trim().toLowerCase() === 'whisper-1'
}

export function isSupportedSpeechFormat(value: string): value is SpeechAudioFormat {
  return SUPPORTED_SPEECH_FORMATS.has(value as SpeechAudioFormat)
}

export function normalizeSpeechFormat(value?: string | null): SpeechAudioFormat {
  if (!value) return 'mp3'
  const normalized = value.trim().toLowerCase()
  if (!isSupportedSpeechFormat(normalized)) {
    throw new Error('Unsupported speech format. Use mp3, wav, aac, or opus.')
  }
  return normalized
}

export function getSpeechContentType(format: SpeechAudioFormat): string {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'aac':
      return 'audio/aac'
    case 'opus':
      return 'audio/opus'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

export function getOptionalString(value: FormDataEntryValue | unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>
}

export function openAIErrorResponse(error: unknown, fallbackMessage: string) {
  let status = 502
  let message = fallbackMessage

  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      status?: number
      message?: string
      error?: { message?: string }
    }

    if (typeof candidate.status === 'number' && candidate.status >= 400 && candidate.status < 600) {
      status = candidate.status
    }

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      message = candidate.message
    } else if (typeof candidate.error?.message === 'string' && candidate.error.message.trim()) {
      message = candidate.error.message
    }
  } else if (error instanceof Error && error.message.trim()) {
    message = error.message
  }

  return json(
    {
      error: message,
      code: 'openai_error',
    },
    { status },
  )
}
