export type ChemicalSearchErrorCode = 'temporary_unavailable' | 'invalid_response'

export class ChemicalSearchError extends Error {
  readonly code: ChemicalSearchErrorCode
  readonly retryable: boolean

  constructor(
    code: ChemicalSearchErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message)
    this.name = 'ChemicalSearchError'
    this.code = code
    this.retryable = options?.retryable ?? code === 'temporary_unavailable'
    if (options && 'cause' in options) this.cause = options.cause
  }
}

export function isChemicalSearchError(error: unknown): error is ChemicalSearchError {
  return error instanceof ChemicalSearchError
}
