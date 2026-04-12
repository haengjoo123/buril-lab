import { beforeEach, describe, expect, it, vi } from 'vitest'

const { playSpeechRemoteMock } = vi.hoisted(() => ({
  playSpeechRemoteMock: vi.fn(),
}))

vi.mock('../services/audioRecorderAdapter', () => ({
  createAudioRecorderAdapter: () => ({
    isSupported: () => true,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}))

vi.mock('../services/openaiVoiceService', () => ({
  speakText: playSpeechRemoteMock,
  transcribeAudio: vi.fn(),
}))

vi.mock('../services/voiceAgentService', () => ({
  queryVoiceAgent: vi.fn(),
  submitVoiceQueryFeedback: vi.fn(),
}))

vi.mock('../locales/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}))

import { useVoiceAgentStore } from '../store/useVoiceAgentStore'

describe('useVoiceAgentStore.applyResult', () => {
  beforeEach(() => {
    playSpeechRemoteMock.mockReset()
    useVoiceAgentStore.setState({
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
  })

  it('closes the sheet and skips TTS for reagent search redirects', async () => {
    const onUiAction = vi.fn().mockResolvedValue(undefined)
    const playSpeech = vi.fn()
    useVoiceAgentStore.setState({ playSpeech })
    useVoiceAgentStore.getState().openSheet({ screen: 'search', language: 'ko' })

    await useVoiceAgentStore.getState().applyResult({
      resolvedText: 'hdg',
      intent: 'disposal',
      answerText: 'MSDS 확인 필요',
      speech: {
        mode: 'remote_audio',
        text: 'MSDS 확인 필요',
      },
      match: null,
      uiAction: {
        type: 'search_reagent',
        query: 'HDG',
      },
      clarification: null,
    }, {
      onUiAction,
    })

    expect(onUiAction).toHaveBeenCalledWith(
      { type: 'search_reagent', query: 'HDG' },
      expect.objectContaining({
        intent: 'disposal',
        resolvedText: 'hdg',
      }),
    )
    expect(playSpeech).not.toHaveBeenCalled()
    expect(useVoiceAgentStore.getState().isOpen).toBe(false)
    expect(useVoiceAgentStore.getState().status).toBe('idle')
  })

  it('continues to play speech for non-search actions', async () => {
    const onUiAction = vi.fn().mockResolvedValue(undefined)
    const playSpeech = vi.fn().mockResolvedValue(undefined)
    useVoiceAgentStore.setState({ playSpeech })
    useVoiceAgentStore.getState().openSheet({ screen: 'cabinet', language: 'ko' })

    await useVoiceAgentStore.getState().applyResult({
      resolvedText: 'hdg',
      intent: 'location',
      answerText: 'HDG는 2번 선반에 있어요.',
      speech: {
        mode: 'remote_audio',
        text: 'HDG는 2번 선반에 있어요.',
      },
      match: null,
      uiAction: {
        type: 'focus_cabinet_item',
        cabinetId: 'cab-1',
        shelfId: 'shelf-2',
        highlightItemId: 'item-1',
      },
      clarification: null,
    }, {
      onUiAction,
    })

    expect(onUiAction).toHaveBeenCalled()
    expect(playSpeech).toHaveBeenCalledWith({
      mode: 'remote_audio',
      text: 'HDG는 2번 선반에 있어요.',
    })
    expect(useVoiceAgentStore.getState().isOpen).toBe(true)
  })
})
