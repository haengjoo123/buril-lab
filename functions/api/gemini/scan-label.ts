// Android 1.0.4 compatibility alias. The implementation is OpenAI-only.
import { onRequestPost as handleOpenAIScanLabel } from '../ai/scan-label'

export const onRequestPost = handleOpenAIScanLabel
