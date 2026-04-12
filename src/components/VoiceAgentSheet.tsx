import { useEffect } from 'react'
import { Bot, Loader2, Mic, Square, Volume2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVoiceAgentStore, type VoiceAgentSubmitOptions } from '../store/useVoiceAgentStore'
import type { VoiceQueryContext, VoiceQueryResponse, VoiceUiAction } from '../utils/voiceAgent'

interface VoiceAgentSheetProps {
  currentContext: VoiceQueryContext
  onUiAction?: (action: VoiceUiAction, result: VoiceQueryResponse) => Promise<void> | void
}

export function VoiceAgentSheet({ currentContext, onUiAction }: VoiceAgentSheetProps) {
  const { t } = useTranslation()
  const {
    isOpen,
    status,
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

  const submitOptions: VoiceAgentSubmitOptions = {
    context: currentContext,
    onUiAction,
  }

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

  if (!isOpen) {
    return null
  }

  const isBusy = status === 'transcribing' || status === 'querying'
  const isRecording = status === 'recording'
  const isPlaying = status === 'playing'
  const helperMessage = (() => {
    if (status === 'recording') return t('voice_agent_recording', 'Listening. Tap again to submit.')
    if (status === 'transcribing') return t('voice_agent_transcribing', 'Transcribing your voice...')
    if (status === 'querying') return t('voice_agent_querying', 'Looking up the reagent...')
    if (status === 'playing') return t('voice_agent_playing', 'Playing the answer...')
    if (status === 'clarifying') return t('voice_agent_clarifying', 'Pick the closest reagent to continue.')
    if (status === 'error') return error || t('voice_agent_error', 'Unable to process the voice request.')
    return t('voice_agent_idle', 'Ask about a reagent\'s location, expiry, remaining amount, or disposal.')
  })()

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
              <p className="text-sm text-slate-700">{helperMessage}</p>
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

                void startRecording()
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

export function openVoiceAgentSheet(context?: VoiceQueryContext) {
  useVoiceAgentStore.getState().openSheet(context)
}
