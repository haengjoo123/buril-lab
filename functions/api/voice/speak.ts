import {
  createOpenAIClient,
  getSpeechContentType,
  isOpenAIAudioEnabled,
  json,
  normalizeSpeechFormat,
  openAIAudioDisabledResponse,
  openAIErrorResponse,
  resolveTtsModel,
  resolveTtsVoice,
  type VoiceEnv,
} from './_shared'
import { readLimitedJson, RequestBodyError, requestBodyErrorResponse } from '../_shared/requestBody'

const MAX_SPEECH_INPUT_LENGTH = 4096
export const MAX_SPEECH_REQUEST_BYTES = 64 * 1024

export const onRequestPost = async (context: {
  request: Request
  env: VoiceEnv
}) => {
  if (!isOpenAIAudioEnabled(context.env)) {
    return openAIAudioDisabledResponse()
  }

  let input: unknown

  try {
    input = await readLimitedJson(context.request, MAX_SPEECH_REQUEST_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyError) return requestBodyErrorResponse(error)
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'A JSON object is required.' }, { status: 400 })
  }
  const body = input as Record<string, unknown>
  if (typeof body.text !== 'string'
    || (body.voice !== undefined && typeof body.voice !== 'string')
    || (body.format !== undefined && typeof body.format !== 'string')) {
    return json({ error: 'Text, voice, and format must be strings.' }, { status: 400 })
  }
  const text = body.text.trim()
  if (!text) {
    return json({ error: 'Text is required.' }, { status: 400 })
  }

  if (text.length > MAX_SPEECH_INPUT_LENGTH) {
    return json(
      { error: `Text must be ${MAX_SPEECH_INPUT_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }

  let format: ReturnType<typeof normalizeSpeechFormat>
  try {
    format = normalizeSpeechFormat(body.format as string | undefined)
  } catch {
    return json({ error: 'Unsupported speech format. Use mp3, wav, aac, or opus.' }, { status: 400 })
  }

  try {
    const model = resolveTtsModel(context.env)
    const voice = (body.voice as string | undefined)?.trim() || resolveTtsVoice(context.env)
    const client = createOpenAIClient(context.env)

    const speech = await client.audio.speech.create({
      input: text,
      model,
      voice,
      response_format: format,
    })

    return new Response(await speech.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': getSpeechContentType(format),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return openAIErrorResponse(error, 'Failed to synthesize speech.')
  }
}
