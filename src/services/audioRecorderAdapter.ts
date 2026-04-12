export interface AudioRecordingResult {
  file: File
  mimeType: string
  durationMs?: number
}

export interface AudioRecorderAdapter {
  isSupported: () => boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<AudioRecordingResult>
}

interface ActiveRecordingSession {
  chunks: BlobPart[]
  mimeType: string
  recorder: MediaRecorder
  startedAt: number
  stream: MediaStream
}

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

function isMediaRecordingSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined'
}

function pickSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }

  return AUDIO_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ''
}

function getAudioFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function stopStreamTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

export function createAudioRecorderAdapter(): AudioRecorderAdapter {
  let activeSession: ActiveRecordingSession | null = null

  return {
    isSupported: () => isMediaRecordingSupported(),
    startRecording: async () => {
      if (!isMediaRecordingSupported()) {
        throw new Error('Audio recording is not supported on this device.')
      }

      if (activeSession) {
        throw new Error('A recording is already in progress.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      const mimeType = pickSupportedMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      const chunks: BlobPart[] = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      })

      recorder.start()
      activeSession = {
        chunks,
        mimeType: mimeType || recorder.mimeType || 'audio/webm',
        recorder,
        startedAt: Date.now(),
        stream,
      }
    },
    stopRecording: async () => {
      if (!activeSession) {
        throw new Error('No active recording to stop.')
      }

      const session = activeSession

      return await new Promise<AudioRecordingResult>((resolve, reject) => {
        const finalize = () => {
          const durationMs = Date.now() - session.startedAt
          const blob = new Blob(session.chunks, { type: session.mimeType })
          const file = new File(
            [blob],
            `voice-${Date.now()}.${getAudioFileExtension(session.mimeType)}`,
            { type: session.mimeType },
          )

          stopStreamTracks(session.stream)
          activeSession = null

          resolve({
            file,
            mimeType: session.mimeType,
            durationMs,
          })
        }

        const handleError = () => {
          stopStreamTracks(session.stream)
          activeSession = null
          reject(new Error('Audio recording failed to stop cleanly.'))
        }

        session.recorder.addEventListener('stop', finalize, { once: true })
        session.recorder.addEventListener('error', handleError, { once: true })

        if (session.recorder.state === 'inactive') {
          finalize()
          return
        }

        session.recorder.requestData()
        session.recorder.stop()
      })
    },
  }
}
