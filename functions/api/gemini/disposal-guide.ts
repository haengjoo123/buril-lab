// Android 1.0.4 compatibility alias. The implementation is OpenAI-only.
import { onRequestPost as handleOpenAIDisposalGuide } from '../ai/disposal-guide'

export const onRequestPost = handleOpenAIDisposalGuide
