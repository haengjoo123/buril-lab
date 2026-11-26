import type { ReactNode } from 'react'

export type SearchBarMode = 'search' | 'agent'

/** URL parameter that puts the search tab in agent mode: /app?mode=agent */
export const AGENT_MODE_PARAM = 'mode'
export const AGENT_MODE_VALUE = 'agent'

/**
 * Everything the search screen needs to offer agent mode. The screen receives
 * this only when the feature is on, so its markup is unchanged when it is off.
 */
export interface SearchAgentModeProps {
  mode: SearchBarMode
  onModeChange: (mode: SearchBarMode) => void
  text: string
  onTextChange: (value: string) => void
  onSubmit: () => void
  onReset: () => void
  isBusy: boolean
  hasTurn: boolean
  /** Rendered in place of the normal search results while in agent mode. */
  resultView: ReactNode
  /** From normal search: switch to agent mode and ask this sentence. */
  onAskAgent: (text: string) => void
}
