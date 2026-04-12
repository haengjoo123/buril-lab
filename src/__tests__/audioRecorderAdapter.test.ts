import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioRecorderAdapter } from '../services/audioRecorderAdapter'

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(type: string) {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm'
  }

  public mimeType: string
  public state: 'inactive' | 'recording' = 'inactive'

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    super()
    this.mimeType = options?.mimeType || 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  requestData() {
    const event = new Event('dataavailable') as Event & { data: Blob }
    event.data = new Blob(['voice-bytes'], { type: this.mimeType })
    this.dispatchEvent(event)
  }

  stop() {
    this.requestData()
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }
}

describe('audioRecorderAdapter', () => {
  const stopTrackMock = vi.fn()
  const getUserMediaMock = vi.fn()

  beforeEach(() => {
    stopTrackMock.mockReset()
    getUserMediaMock.mockReset()
    getUserMediaMock.mockResolvedValue({
      getTracks: () => [{ stop: stopTrackMock }],
    })

    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    })

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    })
  })

  it('reports support when recording APIs are present', () => {
    const adapter = createAudioRecorderAdapter()
    expect(adapter.isSupported()).toBe(true)
  })

  it('records audio and returns a file when stopped', async () => {
    const adapter = createAudioRecorderAdapter()

    await adapter.startRecording()
    const result = await adapter.stopRecording()

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true })
    expect(result.mimeType).toContain('audio/webm')
    expect(result.file).toBeInstanceOf(File)
    expect(result.file.size).toBeGreaterThan(0)
    expect(stopTrackMock).toHaveBeenCalledTimes(1)
  })
})
