/**
 * Reads the components of a waste batch out of one sentence, such as
 * "아세톤 200mL랑 메탄올 100mL 섞은 폐액". Fixed rules only: no model sees the
 * sentence, and nothing here says how anything should be disposed of.
 *
 * A component is a name written next to an amount. Names without an amount
 * are left out rather than guessed at, and a name that cannot be read cleanly
 * is passed on as typed so that the lookup fails instead of finding something
 * else. Imported by Pages Functions through agentGuard, so no browser imports.
 */
export type ParsedWasteAmountUnit = 'uL' | 'mL' | 'L' | 'mg' | 'g' | 'kg'

export interface ParsedWasteAmount {
  value: number
  unit: ParsedWasteAmountUnit
  /** Only a volume can be carried into the batch; a mass is shown and entered in the review. */
  kind: 'volume' | 'mass'
}

export interface ParsedWasteComponent {
  /** The name as typed, trimmed of the words and particles around it. */
  name: string
  amount: ParsedWasteAmount
}

export const WASTE_COMPONENT_LIMIT = 8
const MAX_NAME_LENGTH = 120

const UNITS: ReadonlyArray<[RegExp, ParsedWasteAmountUnit]> = [
  [/^(?:ul|µl|μl|마이크로리터)$/i, 'uL'],
  [/^(?:ml|㎖|cc|밀리리터)$/i, 'mL'],
  [/^(?:l|ℓ|리터)$/i, 'L'],
  [/^(?:mg|밀리그램)$/i, 'mg'],
  [/^(?:kg|킬로그램)$/i, 'kg'],
  [/^(?:g|그램)$/i, 'g'],
]

/** A number followed by a unit, e.g. "200mL", "1.5 L", "1,000 ml", "5 그램". */
const AMOUNT_PATTERN = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(마이크로리터|밀리리터|킬로그램|밀리그램|리터|그램|[uµμ]l|ml|㎖|cc|kg|mg|l|ℓ|g)(?![a-z])/gi

/**
 * Words that join one component to the next. A joining particle counts only
 * as a word of its own: "과산화수소" starts with one and must stay whole.
 */
const LEADING_JOINERS = /^(?:\s*(?:(?:이랑|랑|와|과|하고|그리고|및|and)(?=\s)|[,，、;+&]))+\s*/i
/** A concentration written beside the name, e.g. "10%", "3M", "0.1 N". It is entered in the review. */
const CONCENTRATION_TOKEN = /^\d+(?:\.\d+)?\s*(?:%|퍼센트|mm|m|n)$/i
/** "About" before an amount says nothing about the name. */
const APPROXIMATION_TOKEN = /^(?:약|대략|about|approximately|around|roughly|~)$/i
/** Words about the waste or the place, not part of a name: "폐액통에", "여기에", "waste". */
const CONTEXT_TOKEN = /폐|버리|버려|버릴|섞|혼합|(?:에|에서|에다|에다가|으로|로)$|^(?:waste|into|in|to|the|of|some)$/i
/** A particle attached to the last word of a name. Topic markers are kept: "질산은" is a name. */
const TRAILING_OBJECT_PARTICLE = /(?<=[가-힣])[을를]$/
const TRAILING_JOINER = /(?<=[가-힣])(?:이랑|랑|하고)$|(?<=[가-힣]{2})[와과]$/

function unitOf(raw: string): ParsedWasteAmountUnit | null {
  return UNITS.find(([pattern]) => pattern.test(raw))?.[1] ?? null
}

function nameTokens(area: string): string[] {
  return area.replace(/[()[\]{}"'“”‘’]/g, ' ').split(/\s+/).filter(Boolean)
}

/** The name written just before an amount: the last run of words that are not about the waste itself. */
function nameBefore(area: string): string {
  const tokens = nameTokens(area.replace(LEADING_JOINERS, ''))
  const run: string[] = []
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]
    if (CONCENTRATION_TOKEN.test(token)) continue
    if (run.length === 0 && APPROXIMATION_TOKEN.test(token)) continue
    if (CONTEXT_TOKEN.test(token) || /^[,，、;+&]$/.test(token)) break
    // "황산과 질산 100mL": the word carrying the joiner belongs to another component.
    if (run.length > 0 && TRAILING_JOINER.test(token)) break
    run.unshift(token)
  }
  if (run.length === 0) return ''
  run[run.length - 1] = run[run.length - 1].replace(TRAILING_OBJECT_PARTICLE, '')
  return run.join(' ')
}

/** The name written just after an amount ("200 mL of acetone and ..."): the first run of name words. */
function nameAfter(area: string): string {
  const tokens = nameTokens(area.replace(/^\s*(?:of|의)\s+/i, ''))
  const run: string[] = []
  for (const token of tokens) {
    if (CONCENTRATION_TOKEN.test(token)) continue
    if (run.length === 0 && APPROXIMATION_TOKEN.test(token)) continue
    if (/^(?:and|그리고|및|[,，、;+&])$/i.test(token) || CONTEXT_TOKEN.test(token)) break
    const withoutJoiner = token.replace(/[,，、;]$/, '').replace(TRAILING_JOINER, '')
    run.push(withoutJoiner)
    // A joiner or comma attached to the word ends the name.
    if (withoutJoiner !== token) break
  }
  return run.join(' ')
}

export function parseWasteComponents(input: string): ParsedWasteComponent[] {
  const text = input.normalize('NFKC')
  const amounts = [...text.matchAll(AMOUNT_PATTERN)].flatMap((match) => {
    const unit = unitOf(match[2])
    const value = Number(match[1].replace(/,/g, ''))
    if (!unit || !Number.isFinite(value) || value <= 0) return []
    return [{
      start: match.index,
      end: match.index + match[0].length,
      amount: { value, unit, kind: unit === 'uL' || unit === 'mL' || unit === 'L' ? 'volume' : 'mass' } as ParsedWasteAmount,
    }]
  })
  if (amounts.length === 0) return []

  // One sentence keeps one order. If nothing readable precedes the first amount, names follow amounts.
  const amountFirst = nameBefore(text.slice(0, amounts[0].start)) === ''
  const components: ParsedWasteComponent[] = []
  amounts.forEach((entry, index) => {
    const area = amountFirst
      ? text.slice(entry.end, amounts[index + 1]?.start ?? text.length)
      : text.slice(amounts[index - 1]?.end ?? 0, entry.start)
    const name = (amountFirst ? nameAfter(area) : nameBefore(area)).slice(0, MAX_NAME_LENGTH).trim()
    // A bare number or symbol is not a name.
    if (!/[a-z가-힣]/i.test(name)) return
    components.push({ name, amount: entry.amount })
  })
  return components.slice(0, WASTE_COMPONENT_LIMIT)
}
