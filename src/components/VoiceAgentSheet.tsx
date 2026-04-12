import { useEffect } from 'react'
import { Bot, Loader2, Mic, Send, Square, Volume2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useVoiceAgentStore, type VoiceAgentSubmitOptions } from '../store/useVoiceAgentStore'
import type { VoiceQueryContext, VoiceQueryResponse, VoiceUiAction } from '../utils/voiceAgent'

interface VoiceAgentSheetProps {
  currentContext: VoiceQueryContext
  onUiAction?: (action: VoiceUiAction, result: VoiceQueryResponse) => Promise<void> | void
}

function appendIntentTemplate(inputText: string, label: 'location' | 'expiration' | 'remaining' | 'disposal') {
  const trimmed = inputText.trim()
  const templates = {
    location: '위치 알려줘',
    expiration: '유통기한 얼마나 남았어?',
    remaining: '잔량 얼마나 남았어?',
    disposal: '어떻게 버려야 해?',
  } as const

  if (!trimmed) {
    return templates[label]
  }

  return `${trimmed} ${templates[label]}`
}

export function VoiceAgentSheet({ currentContext, onUiAction }: VoiceAgentSheetProps) {
  const { t } = useTranslation()
  const {
    isOpen,
    status,
    inputText,
    transcriptText,
    resolvedText,
    answerText,
    error,
    clarification,
    isRecordingSupported,
    closeSheet,
    setContext,
    setInputText,
    startRecording,
    stopRecordingAndSubmit,
    submitText,
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
    if (status === 'recording') return t('voice_agent_recording', '질문을 듣고 있어요. 다시 누르면 전송합니다.')
    if (status === 'transcribing') return t('voice_agent_transcribing', '음성을 텍스트로 바꾸고 있어요...')
    if (status === 'querying') return t('voice_agent_querying', '시약 정보를 찾고 있어요...')
    if (status === 'playing') return t('voice_agent_playing', '답변을 음성으로 재생하고 있어요.')
    if (status === 'clarifying') return t('voice_agent_clarifying', '후보를 골라 주시면 바로 다시 찾아볼게요.')
    if (status === 'error') return error || t('voice_agent_error', '음성 도우미를 처리하지 못했어요.')
    return t('voice_agent_idle', '시약명과 함께 위치, 유통기한, 잔량, 폐기를 물어보세요.')
  })()

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 backdrop-blur-sm">
      <button
        type="button"
        aria-label={t('voice_agent_close_overlay', 'Close voice assistant')}
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
                {t('voice_agent_title', 'AI 도우미')}
              </h2>
              <p className="text-xs text-slate-500">
                {currentContext.screen === 'cabinet'
                  ? t('voice_agent_context_cabinet', '현재 시약장 맥락에서 찾습니다.')
                  : t('voice_agent_context_search', '검색과 시약장 데이터를 함께 조회합니다.')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeSheet}
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

          <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto]">
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
              className={`flex h-14 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition-colors ${
                isRecording
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300'
              }`}
            >
              {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>
                {isRecording
                  ? t('voice_agent_stop_recording', '녹음 종료')
                  : t('voice_agent_start_recording', '음성 질문')}
              </span>
            </button>

            <div className="flex min-h-14 items-center rounded-2xl border border-slate-200 bg-white px-4">
              <input
                type="text"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder={t('voice_agent_input_placeholder', '예: Sodium nitrate 유통기한 얼마나 남았어?')}
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                disabled={isBusy}
              />
            </div>

            <button
              type="button"
              disabled={isBusy || !inputText.trim()}
              onClick={() => void submitText(undefined, submitOptions)}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:bg-slate-300"
            >
              <Send className="h-4 w-4" />
              <span>{t('voice_agent_send', '질문')}</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setInputText(appendIntentTemplate(inputText, 'location'))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              {t('voice_agent_chip_location', '위치')}
            </button>
            <button
              type="button"
              onClick={() => setInputText(appendIntentTemplate(inputText, 'expiration'))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              {t('voice_agent_chip_expiration', '유통기한')}
            </button>
            <button
              type="button"
              onClick={() => setInputText(appendIntentTemplate(inputText, 'remaining'))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              {t('voice_agent_chip_remaining', '잔량')}
            </button>
            <button
              type="button"
              onClick={() => setInputText(appendIntentTemplate(inputText, 'disposal'))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              {t('voice_agent_chip_disposal', '폐기')}
            </button>
          </div>

          {transcriptText && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                {t('voice_agent_transcript', '전사 결과')}
              </p>
              <p className="mt-1 text-sm text-slate-800">{transcriptText}</p>
            </div>
          )}

          {resolvedText && resolvedText !== transcriptText && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t('voice_agent_resolved', '해석된 질의')}
              </p>
              <p className="mt-1 text-sm text-slate-800">{resolvedText}</p>
            </div>
          )}

          {answerText && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {t('voice_agent_answer', '답변')}
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
                  {clarification.candidates.map((candidate) => (
                    <button
                      key={`${candidate.source}:${candidate.id}`}
                      type="button"
                      onClick={() => void submitCorrection(candidate.name, submitOptions)}
                      className="rounded-xl border border-amber-200 bg-white px-3 py-3 text-left text-sm text-slate-800 transition-colors hover:bg-amber-100"
                    >
                      <div className="font-medium">{candidate.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {candidate.cabinetName && `${candidate.cabinetName} `}
                        {typeof candidate.shelfLevel === 'number' && `${candidate.shelfLevel + 1}번 선반 `}
                        {candidate.storageLocationName && `${candidate.storageLocationName}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void submitCorrection(inputText, submitOptions)}
                  disabled={!inputText.trim() || isBusy}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:bg-slate-300"
                >
                  {t('voice_agent_submit_correction', '교정해서 다시 찾기')}
                </button>
                <button
                  type="button"
                  onClick={cancelCurrentTurn}
                  className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-amber-100"
                >
                  {t('voice_agent_clear', '초기화')}
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
