import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { ResponseInput } from 'openai/resources/responses/responses'
import type { ZodType } from 'zod'

export interface OpenAIResponsesEnv {
  OPENAI_API_KEY?: string
  OPENAI_RESPONSES_MODEL?: string
  OPENAI_SAFETY_HMAC_SECRET?: string
}

export interface ParsedOpenAIResponse<T> {
  data: T
  model: string
  responseId: string
}

export const DEFAULT_OPENAI_RESPONSES_MODEL = 'gpt-5.6-luna'
export const OPENAI_RESPONSES_TIMEOUT_MS = 20_000
export const OPENAI_RESPONSES_MAX_RETRIES = 2

export function resolveOpenAIResponsesModel(env: OpenAIResponsesEnv): string {
  return env.OPENAI_RESPONSES_MODEL?.trim() || DEFAULT_OPENAI_RESPONSES_MODEL
}

export function isOpenAIResponsesConfigured(env: OpenAIResponsesEnv): boolean {
  return Boolean(
    env.OPENAI_API_KEY?.trim()
    && env.OPENAI_SAFETY_HMAC_SECRET?.trim(),
  )
}

export function createOpenAIResponsesClient(env: OpenAIResponsesEnv): OpenAI {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured.')
  }

  return new OpenAI({
    apiKey,
    timeout: OPENAI_RESPONSES_TIMEOUT_MS,
    maxRetries: OPENAI_RESPONSES_MAX_RETRIES,
  })
}

export async function createSafetyIdentifier(
  env: OpenAIResponsesEnv,
  userId: string | null | undefined,
): Promise<string> {
  const secret = env.OPENAI_SAFETY_HMAC_SECRET?.trim()
  if (!secret) {
    throw new Error('OpenAI safety HMAC secret is not configured.')
  }
  if (!userId?.trim()) {
    throw new Error('Authenticated user context is required for OpenAI requests.')
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(userId.trim()))

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function getRequestUserId(data?: Record<string, unknown>): string | null {
  return typeof data?.userId === 'string' && data.userId.trim()
    ? data.userId.trim()
    : null
}

export function summarizeOpenAIError(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== 'object') {
    return { name: 'UnknownError' }
  }

  const value = error as {
    name?: unknown
    status?: unknown
    code?: unknown
    type?: unknown
  }
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
  }
}

export async function parseOpenAIResponse<T>(
  env: OpenAIResponsesEnv,
  options: {
    input: string | ResponseInput
    maxOutputTokens: number
    safetyIdentifier: string
    schema: ZodType<T>
    schemaName: string
  },
): Promise<ParsedOpenAIResponse<T>> {
  const client = createOpenAIResponsesClient(env)
  const model = resolveOpenAIResponsesModel(env)
  const response = await client.responses.parse({
    model,
    input: options.input,
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: 'none' },
    safety_identifier: options.safetyIdentifier,
    store: false,
    text: {
      format: zodTextFormat(options.schema, options.schemaName),
    },
  })

  if (response.status !== 'completed') {
    throw new Error(`OpenAI response was incomplete (${response.status}).`)
  }

  const data = response.output_parsed as T | null
  if (!data) {
    const refused = response.output.some((item) => (
      item.type === 'message'
      && item.content.some((content) => content.type === 'refusal')
    ))
    throw new Error(refused
      ? 'OpenAI refused the structured response.'
      : 'OpenAI returned no structured response.')
  }

  return {
    data,
    model: response.model || model,
    responseId: response.id,
  }
}
