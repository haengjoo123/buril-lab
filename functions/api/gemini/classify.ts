// Android 1.0.4 compatibility alias. The implementation is OpenAI-only.
import { onRequestPost as handleOpenAIClassify } from '../ai/classify'

export const onRequestPost = handleOpenAIClassify
