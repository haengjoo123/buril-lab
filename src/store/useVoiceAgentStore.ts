import { create } from 'zustand'
import { createAudioRecorderAdapter } from '../services/audioRecorderAdapter'
import { speakText, transcribeAudio } from '../services/openaiVoiceService'
import { queryVoiceAgent, submitVoiceQueryFeedback } from '../services/voiceAgentService'
import type {
  VoiceAgentIntent,
  VoiceClarification,
  VoiceQueryContext,
  VoiceQueryResponse,
  VoiceSpeechPayload,
  VoiceUiAction,
} from '../utils/voiceAgent'

export type VoiceAgentStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'querying'
  | 'playing'
  | 'clarifying'
  | 'error'

export interface VoiceAgentSubmitOptions {
  context?: VoiceQueryContext
  onUiAction?: (action: VoiceUiAction, result: VoiceQueryResponse) => Promise<void> | void
}

interface VoiceAgentStore {
  isOpen: boolean
  context: VoiceQueryContext
  status: VoiceAgentStatus
  inputText: string
  transcriptText: string
  resolvedText: string
  answerText: string
  error: string | null
  intent: VoiceAgentIntent | null
  clarification: VoiceClarification | null
  lastRawInput: string
  lastResponse: VoiceQueryResponse | null
  turnId: number
  isRecordingSupported: boolean
  openSheet: (context?: VoiceQueryContext) => void
  closeSheet: () => void
  setContext: (context?: VoiceQueryContext) => void
  setInputText: (text: string) => void
  startRecording: () => Promise<void>
  stopRecordingAndSubmit: (options?: VoiceAgentSubmitOptions) => Promise<void>
  submitText: (text?: string, options?: VoiceAgentSubmitOptions) => Promise<void>
  applyResult: (result: VoiceQueryResponse, options?: VoiceAgentSubmitOptions) => Promise<void>
  playSpeech: (speech: VoiceSpeechPayload) => Promise<void>
  stopSpeaking: () => void
  submitCorrection: (text: string, options?: VoiceAgentSubmitOptions) => Promise<void>
  cancelCurrentTurn: () => void
}

const recorder = createAudioRecorderAdapter()
let activeAudio: HTMLAudioElement | null = null
let activeAudioUrl: string | null = null

function stopActiveAudioPlayback() {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }

  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl)
    activeAudioUrl = null
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

async function playDeviceTts(text: string): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    throw new Error('Device TTS is not available on this device.')
  }

  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Device TTS playback failed.'))
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

async function playRemoteAudio(text: string): Promise<void> {
  const { blob } = await speakText(text, { format: 'mp3' })
  activeAudioUrl = URL.createObjectURL(blob)
  activeAudio = new Audio(activeAudioUrl)
  activeAudio.preload = 'auto'
  await activeAudio.play()
  await new Promise<void>((resolve, reject) => {
    if (!activeAudio) {
      resolve()
      return
    }

    activeAudio.onended = () => resolve()
    activeAudio.onerror = () => reject(new Error('Audio playback failed.'))
  })
}

const initialContext: VoiceQueryContext = {
  screen: 'search',
  language: 'ko',
}

export const useVoiceAgentStore = create<VoiceAgentStore>((set, get) => ({
  isOpen: false,
  context: initialContext,
  status: 'idle',
  inputText: '',
  transcriptText: '',
  resolvedText: '',
  answerText: '',
  error: null,
  intent: null,
  clarification: null,
  lastRawInput: '',
  lastResponse: null,
  turnId: 0,
  isRecordingSupported: recorder.isSupported(),

  openSheet: (context) => set((state) => ({
    isOpen: true,
    context: {
      ...state.context,
      ...context,
    },
    error: null,
  })),

  closeSheet: () => {
    get().cancelCurrentTurn()
    set({
      isOpen: false,
      status: 'idle',
      inputText: '',
      transcriptText: '',
      resolvedText: '',
      answerText: '',
      error: null,
      intent: null,
      clarification: null,
      lastRawInput: '',
      lastResponse: null,
    })
  },

  setContext: (context) => set((state) => ({
    context: {
      ...state.context,
      ...context,
    },
  })),

  setInputText: (text) => set({ inputText: text }),

  startRecording: async () => {
    try {
      get().cancelCurrentTurn()

      if (!recorder.isSupported()) {
        set({
          status: 'error',
          error: '이 기기에서는 음성 녹음을 지원하지 않아요. 텍스트 질문을 사용해 주세요.',
        })
        return
      }

      await recorder.startRecording()
      set({
        status: 'recording',
        error: null,
        clarification: null,
        transcriptText: '',
        answerText: '',
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '마이크를 시작하지 못했어요.',
      })
    }
  },

  stopRecordingAndSubmit: async (options) => {
    const nextTurnId = get().turnId + 1
    set({
      turnId: nextTurnId,
      status: 'transcribing',
      error: null,
    })

    try {
      const recording = await recorder.stopRecording()
      if (get().turnId !== nextTurnId) return

      const context = options?.context || get().context
      const transcription = await transcribeAudio(recording.file, {
        language: context.language,
        prompt: 'laboratory reagent names, CAS numbers, cabinet locations, expiration dates, and disposal questions',
      })

      if (get().turnId !== nextTurnId) return

      set({
        transcriptText: transcription.text,
        resolvedText: transcription.text,
        inputText: transcription.text,
        lastRawInput: transcription.text,
        status: 'querying',
      })

      const response = await queryVoiceAgent({
        text: transcription.text,
        source: 'voice',
        context,
        transcriptMeta: {
          model: transcription.model,
          durationMs: transcription.durationMs,
        },
      })

      if (get().turnId !== nextTurnId) return
      await get().applyResult(response, {
        ...options,
        context,
      })
    } catch (error) {
      if (get().turnId !== nextTurnId) return
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '음성 질문을 처리하지 못했어요.',
      })
    }
  },

  submitText: async (text, options) => {
    const trimmedText = (text ?? get().inputText).trim()
    if (!trimmedText) {
      set({
        status: 'error',
        error: '질문 내용을 입력해 주세요.',
      })
      return
    }

    get().stopSpeaking()
    const nextTurnId = get().turnId + 1
    const context = options?.context || get().context

    set({
      turnId: nextTurnId,
      status: 'querying',
      error: null,
      clarification: null,
      inputText: trimmedText,
      transcriptText: '',
      lastRawInput: trimmedText,
    })

    try {
      const response = await queryVoiceAgent({
        text: trimmedText,
        source: 'typed',
        context,
      })

      if (get().turnId !== nextTurnId) return
      await get().applyResult(response, {
        ...options,
        context,
      })
    } catch (error) {
      if (get().turnId !== nextTurnId) return
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '질문을 처리하지 못했어요.',
      })
    }
  },

  applyResult: async (result, options) => {
    set({
      lastResponse: result,
      resolvedText: result.resolvedText,
      intent: result.intent,
      answerText: result.answerText,
      clarification: result.clarification,
      error: null,
      status: result.clarification ? 'clarifying' : 'querying',
    })

    if (result.uiAction.type !== 'none' && result.uiAction.type !== 'clarify') {
      await options?.onUiAction?.(result.uiAction, result)
    }

    if (result.clarification) {
      return
    }

    await get().playSpeech(result.speech)
  },

  playSpeech: async (speech) => {
    stopActiveAudioPlayback()

    if (speech.mode === 'none' || !speech.text.trim()) {
      set({ status: 'idle' })
      return
    }

    set({ status: 'playing' })

    try {
      await playRemoteAudio(speech.text)
      if (get().status === 'playing') {
        set({ status: 'idle' })
      }
    } catch (remoteError) {
      console.warn('[voice-agent] remote TTS fallback:', remoteError)

      try {
        await playDeviceTts(speech.text)
      } catch (deviceError) {
        console.warn('[voice-agent] device TTS fallback failed:', deviceError)
      } finally {
        if (get().status === 'playing') {
          set({ status: 'idle' })
        }
      }
    }
  },

  stopSpeaking: () => {
    stopActiveAudioPlayback()
    set((state) => ({
      status: state.status === 'playing' ? 'idle' : state.status,
    }))
  },

  submitCorrection: async (text, options) => {
    const correctionText = text.trim()
    if (!correctionText) {
      set({
        status: 'error',
        error: '교정할 시약명을 입력해 주세요.',
      })
      return
    }

    const previousResponse = get().lastResponse
    const previousInput = get().lastRawInput
    if (previousInput) {
      try {
        await submitVoiceQueryFeedback({
          rawInput: previousInput,
          normalizedQuery: get().resolvedText,
          intent: get().intent || undefined,
          failureReason: 'user_corrected',
          correctionText,
          selectedMatchSource: previousResponse?.match?.source,
          selectedMatchId: previousResponse?.match?.id,
          metadata: {
            context: options?.context || get().context,
          },
        })
      } catch (error) {
        console.warn('[voice-agent] feedback insert failed:', error)
      }
    }

    set({
      inputText: correctionText,
      clarification: null,
    })

    await get().submitText(correctionText, options)
  },

  cancelCurrentTurn: () => {
    stopActiveAudioPlayback()

    if (get().status === 'recording') {
      void recorder.stopRecording().catch(() => undefined)
    }

    set((state) => ({
      turnId: state.turnId + 1,
      status: 'idle',
      error: null,
    }))
  },
}))
