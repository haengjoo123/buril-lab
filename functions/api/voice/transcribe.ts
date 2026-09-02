import {
  createOpenAIClient,
  getOptionalString,
  isOpenAIAudioEnabled,
  json,
  openAIAudioDisabledResponse,
  openAIErrorResponse,
  resolveSttModel,
  supportsVerboseTranscription,
  type VoiceEnv,
} from './_shared'
import {
  readLimitedFormData, RequestBodyError, requestBodyErrorResponse, requestBodyTooLarge,
} from '../_shared/requestBody'

export const MAX_AUDIO_FILE_BYTES = 5 * 1024 * 1024
export const MAX_AUDIO_REQUEST_BYTES = MAX_AUDIO_FILE_BYTES + 64 * 1024

interface TranscriptionResponse {
  text: string
  language?: string
  durationMs?: number
  model: string
}

export const onRequestPost = async (context: {
  request: Request
  env: VoiceEnv
}) => {
  if (!isOpenAIAudioEnabled(context.env)) {
    return openAIAudioDisabledResponse()
  }

  const contentType = context.request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data.' }, { status: 400 })
  }

  try {
    const formData = await readLimitedFormData(context.request, MAX_AUDIO_REQUEST_BYTES)
    const file = formData.get('file')

    if (!(file instanceof File) || file.size <= 0) {
      return json({ error: 'An audio file is required.' }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_FILE_BYTES) throw requestBodyTooLarge()

    const model = resolveSttModel(context.env)
    const language = getOptionalString(formData.get('language'))
    const prompt = getOptionalString(formData.get('prompt'))
    const client = createOpenAIClient(context.env)

    const transcription = supportsVerboseTranscription(model)
      ? await client.audio.transcriptions.create({
        file,
        model,
        language,
        prompt,
        response_format: 'verbose_json',
      })
      : await client.audio.transcriptions.create({
        file,
        model,
        language,
        prompt,
      })

    const response: TranscriptionResponse = {
      text: transcription.text,
      model,
    }

    if ('language' in transcription && typeof transcription.language === 'string' && transcription.language) {
      response.language = transcription.language
    } else if (language) {
      response.language = language
    }

    if ('duration' in transcription && typeof transcription.duration === 'number') {
      response.durationMs = Math.round(transcription.duration * 1000)
    } else if (
      'usage' in transcription &&
      transcription.usage?.type === 'duration' &&
      typeof transcription.usage.seconds === 'number'
    ) {
      response.durationMs = Math.round(transcription.usage.seconds * 1000)
    }

    return json(response)
  } catch (error) {
    if (error instanceof RequestBodyError) return requestBodyErrorResponse(error)
    return openAIErrorResponse(error, 'Failed to transcribe audio.')
  }
}
