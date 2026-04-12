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

interface SpeakRequest {
  text?: string
  voice?: string
  format?: 'mp3' | 'wav' | 'aac' | 'opus'
}

const MAX_SPEECH_INPUT_LENGTH = 4096

export const onRequestPost = async (context: {
  request: Request
  env: VoiceEnv
}) => {
  if (!isOpenAIAudioEnabled(context.env)) {
    return openAIAudioDisabledResponse()
  }

  let body: SpeakRequest

  try {
    body = await context.request.json() as SpeakRequest
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text) {
    return json({ error: 'Text is required.' }, { status: 400 })
  }

  if (text.length > MAX_SPEECH_INPUT_LENGTH) {
    return json(
      { error: `Text must be ${MAX_SPEECH_INPUT_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }

  try {
    const format = normalizeSpeechFormat(body.format)
    const model = resolveTtsModel(context.env)
    const voice = body.voice?.trim() || resolveTtsVoice(context.env)
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
