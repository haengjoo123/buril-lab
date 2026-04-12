export interface AudioRecordingResult {
  file: File
  mimeType: string
  durationMs?: number
}

export interface AudioRecorderAdapter {
  isSupported: () => boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<AudioRecordingResult>
  getInputActivity: (barCount?: number) => number[] | null
}

interface ActiveRecordingSession {
  analyser: AnalyserNode | null
  analysisData: Uint8Array<ArrayBuffer> | null
  audioContext: AudioContext | null
  chunks: BlobPart[]
  mimeType: string
  recorder: MediaRecorder
  startedAt: number
  stream: MediaStream
  sourceNode: MediaStreamAudioSourceNode | null
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

function createAudioAnalysisSession(stream: MediaStream): Pick<
  ActiveRecordingSession,
  'analyser' | 'analysisData' | 'audioContext' | 'sourceNode'
> {
  const audioWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextConstructor = window.AudioContext || audioWindow.webkitAudioContext

  if (!AudioContextConstructor) {
    return {
      analyser: null,
      analysisData: null,
      audioContext: null,
      sourceNode: null,
    }
  }

  const audioContext = new AudioContextConstructor()
  const sourceNode = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.82
  sourceNode.connect(analyser)

  void audioContext.resume().catch(() => undefined)

  return {
    analyser,
    analysisData: new Uint8Array(analyser.frequencyBinCount),
    audioContext,
    sourceNode,
  }
}

function disposeAudioAnalysisSession(session: ActiveRecordingSession) {
  session.sourceNode?.disconnect()
  session.analyser?.disconnect()
  void session.audioContext?.close().catch(() => undefined)
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
      const analysisSession = createAudioAnalysisSession(stream)

      const chunks: BlobPart[] = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      })

      recorder.start()
      activeSession = {
        ...analysisSession,
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
          disposeAudioAnalysisSession(session)
          activeSession = null

          resolve({
            file,
            mimeType: session.mimeType,
            durationMs,
          })
        }

        const handleError = () => {
          stopStreamTracks(session.stream)
          disposeAudioAnalysisSession(session)
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
    getInputActivity: (barCount = 20) => {
      const session = activeSession
      if (!session || !session.analyser || !session.analysisData || barCount <= 0) {
        return null
      }

      const analysisData = session.analysisData
      session.analyser.getByteFrequencyData(analysisData)

      const bucketSize = Math.max(1, Math.floor(analysisData.length / barCount))
      return Array.from({ length: barCount }, (_, index) => {
        const start = index * bucketSize
        const end = Math.min(analysisData.length, start + bucketSize)

        if (start >= end) return 0

        let total = 0
        for (let dataIndex = start; dataIndex < end; dataIndex += 1) {
          total += analysisData[dataIndex]
        }

        const normalized = total / ((end - start) * 255)
        return Math.min(1, Math.sqrt(normalized))
      })
    },
  }
}
