import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Mic, Square, Volume2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  VOICE_RECORDING_MAX_DURATION_MS,
  useVoiceAgentStore,
  type VoiceAgentSubmitOptions,
} from '../store/useVoiceAgentStore'
import type { VoiceQueryContext, VoiceQueryResponse, VoiceUiAction } from '../utils/voiceAgent'

interface VoiceAgentSheetProps {
  currentContext: VoiceQueryContext
  onUiAction?: (action: VoiceUiAction, result: VoiceQueryResponse) => Promise<void> | void
}

const VOICE_ACTIVITY_DOT_COUNT = 18

function createIdleDotTrail(): number[] {
  return Array.from({ length: VOICE_ACTIVITY_DOT_COUNT }, () => 0)
}

const IDLE_DOT_TRAIL = createIdleDotTrail()

export function VoiceAgentSheet({ currentContext, onUiAction }: VoiceAgentSheetProps) {
  const { t } = useTranslation()
  const {
    isOpen,
    status,
    recordingLevels,
    transcriptText,
    resolvedText,
    answerText,
    error,
    clarification,
    isRecordingSupported,
    closeSheet,
    setContext,
    startRecording,
    stopRecordingAndSubmit,
    stopSpeaking,
    submitCorrection,
    cancelCurrentTurn,
  } = useVoiceAgentStore()
  const [dotTrail, setDotTrail] = useState<number[]>(() => createIdleDotTrail())
  const latestLevelRef = useRef(0)

  const submitOptions: VoiceAgentSubmitOptions = {
    context: currentContext,
    onUiAction,
  }
  const isBusy = status === 'transcribing' || status === 'querying'
  const isRecording = status === 'recording'
  const isPlaying = status === 'playing'
  const visibleDotTrail = isRecording ? dotTrail : IDLE_DOT_TRAIL
  const recordingAutoStopSeconds = Math.round(VOICE_RECORDING_MAX_DURATION_MS / 1000)
  const helperMessage = (() => {
    if (status === 'recording') {
      return t('voice_agent_recording', {
        seconds: recordingAutoStopSeconds,
        defaultValue: `Listening to your question. Tap again to send or wait ${recordingAutoStopSeconds} seconds for it to stop automatically.`,
      })
    }
    if (status === 'transcribing') return t('voice_agent_transcribing', 'Transcribing your voice...')
    if (status === 'querying') return t('voice_agent_querying', 'Looking up the reagent...')
    if (status === 'playing') return t('voice_agent_playing', 'Playing the answer...')
    if (status === 'clarifying') return t('voice_agent_clarifying', 'Pick the closest reagent to continue.')
    if (status === 'error') return error || t('voice_agent_error', 'Unable to process the voice request.')
    return t('voice_agent_idle', 'Ask about a reagent\'s location, expiry, remaining amount, or disposal.')
  })()

  useEffect(() => {
    setContext(currentContext)
  }, [currentContext, setContext])

  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSheet()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeSheet, isOpen])

  useEffect(() => {
    const totalLevel = recordingLevels.reduce((sum, level, index) => {
      const weight = index < 6 ? 1.2 : 0.85
      return sum + level * weight
    }, 0)

    latestLevelRef.current = Math.min(1, totalLevel / Math.max(1, recordingLevels.length))
  }, [recordingLevels])

  useEffect(() => {
    if (!isRecording) {
      latestLevelRef.current = 0
      return
    }

    const timer = window.setInterval(() => {
      const nextLevel = latestLevelRef.current

      setDotTrail((previousTrail) => [
        nextLevel,
        ...previousTrail.slice(0, VOICE_ACTIVITY_DOT_COUNT - 1),
      ])
    }, 90)

    return () => window.clearInterval(timer)
  }, [isRecording])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 backdrop-blur-sm">
      <button
        type="button"
        aria-label={t('voice_agent_close_overlay', 'Close AI voice agent')}
        className="absolute inset-0"
        onClick={closeSheet}
      />

      <div className="relative z-[91] w-full max-w-2xl rounded-t-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t('voice_agent_title', 'AI Voice Agent')}
              </h2>
              <p className="text-xs text-slate-500">
                {currentContext.screen === 'cabinet'
                  ? t('voice_agent_context_cabinet', 'Searching within the current cabinet context.')
                  : t('voice_agent_context_search', 'Searching across search and cabinet data.')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeSheet}
            aria-label={t('btn_close', 'Close')}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto px-5 py-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-blue-600">
                {status === 'recording' || status === 'transcribing' || status === 'querying' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status === 'playing' ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700">{helperMessage}</p>

                {isRecording && (
                  <div
                    role="status"
                    aria-label="Microphone input visualizer"
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm"
                  >
                    <div className="flex items-center gap-1.5" aria-hidden="true">
                      {visibleDotTrail.map((level, index) => {
                        const previousLevel = visibleDotTrail[index - 1] ?? level
                        const nextLevel = visibleDotTrail[index + 1] ?? 0
                        const smoothedLevel = Math.min(1, level * 0.62 + previousLevel * 0.24 + nextLevel * 0.14)
                        const ageFade = Math.max(0.58, 1 - index * 0.03)

                        return (
                          <span
                            key={`voice-dot-${index}`}
                            className="rounded-full bg-slate-500 transition-all duration-100 ease-out"
                            style={{
                              width: `${Math.max(5, Math.round(5 + smoothedLevel * 7))}px`,
                              height: `${Math.max(5, Math.round(5 + smoothedLevel * 7))}px`,
                              opacity: Math.min(1, 0.22 + smoothedLevel * 0.72) * ageFade,
                              transform: `translateY(${Math.round((1 - smoothedLevel) * 1.5)}px)`,
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => {
                if (isRecording) {
                  void stopRecordingAndSubmit(submitOptions)
                  return
                }

                setDotTrail(createIdleDotTrail())
                latestLevelRef.current = 0
                void startRecording(submitOptions)
              }}
              disabled={!isRecordingSupported || isBusy}
              className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition-colors ${
                isRecording
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300'
              }`}
            >
              {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>
                {isRecording
                  ? t('voice_agent_stop_recording', 'Stop recording')
                  : t('voice_agent_start_recording', 'Voice question')}
              </span>
            </button>
          </div>

          {transcriptText && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                {t('voice_agent_transcript', 'Transcript')}
              </p>
              <p className="mt-1 text-sm text-slate-800">{transcriptText}</p>
            </div>
          )}

          {resolvedText && resolvedText !== transcriptText && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('voice_agent_resolved', 'Resolved query')}
              </p>
              <p className="mt-1 text-sm text-slate-800">{resolvedText}</p>
            </div>
          )}

          {answerText && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {t('voice_agent_answer', 'Answer')}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-900">{answerText}</p>
                </div>
                {isPlaying && (
                  <button
                    type="button"
                    onClick={stopSpeaking}
                    className="rounded-full border border-emerald-200 bg-white p-2 text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {clarification && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-medium text-amber-900">{clarification.message}</p>

              {clarification.candidates.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {clarification.candidates.map((candidate) => {
                    const candidateMeta = [
                      candidate.cabinetName,
                      typeof candidate.shelfLevel === 'number'
                        ? t('cabinet_shelf_level', { level: candidate.shelfLevel + 1 })
                        : null,
                      candidate.storageLocationName,
                    ]
                      .filter((value): value is string => Boolean(value))
                      .join(' · ')

                    return (
                      <button
                        key={`${candidate.source}:${candidate.id}`}
                        type="button"
                        onClick={() => void submitCorrection(candidate.name, submitOptions)}
                        className="rounded-xl border border-amber-200 bg-white px-3 py-3 text-left text-sm text-slate-800 transition-colors hover:bg-amber-100"
                      >
                        <div className="font-medium">{candidate.name}</div>
                        {candidateMeta && (
                          <div className="mt-1 text-xs text-slate-500">{candidateMeta}</div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={cancelCurrentTurn}
                  className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-amber-100"
                >
                  {t('voice_agent_clear', 'Clear')}
                </button>
              </div>
            </div>
          )}

          {error && status === 'error' && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
