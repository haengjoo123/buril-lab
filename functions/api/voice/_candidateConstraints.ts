import { normalizeCasNumber } from '../../../src/utils/casNumber'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'

const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
const ordinals: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  첫: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
}
const escapeLabel = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&')

function mentionsLabel(query: string, name: string) {
  if (!name || !query.includes(name)) return false
  return new RegExp(
    '(?<![\\p{L}\\p{N}])' + escapeLabel(name) + '(?=$|[^\\p{L}\\p{N}]|(?:을|를|은|는|이|가)(?=$|[^\\p{L}\\p{N}]))',
    'u',
  ).test(query)
}

const waters: Record<string, number> = {
  hemi: 0.5,
  mono: 1,
  sesqui: 1.5,
  di: 2,
  tri: 3,
  tetra: 4,
  penta: 5,
  hexa: 6,
  hepta: 7,
  octa: 8,
  nona: 9,
  deca: 10,
  dodeca: 12,
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
  십: 10,
  십이: 12,
}
function hydration(text: string) {
  const dry = /\banhydrous\b|(?:^|[\s(])무수(?:물)?(?=$|[\s(),]|[은는을를](?:\s|$))/u.test(text)
  const hydrated =
    /\b(?:mono|di|tri|tetra|penta|hexa|hepta|octa|nona|deca|dodeca|hemi|sesqui|poly)?hydrat(?:es?|ed)\b|수화물/u.test(
      text,
    )
  const counts = new Set(
    Array.from(
      text.matchAll(
        /\b(hemi|mono|sesqui|di|tri|tetra|penta|hexa|hepta|octa|nona|deca|dodeca)hydrates?\b|(?:^|[\s(])(\d+|십이|[일이삼사오육칠팔구십])\s*수화물/gu,
      ),
      (match) => waters[match[1] ?? match[2]] ?? Number(match[2]),
    ),
  )
  if ((dry && hydrated) || counts.size > 1) return 'ambiguous'
  return dry ? 'dry' : hydrated ? (counts.values().next().value ?? 'hydrate') : null
}

function shelfNumbers(query: string) {
  const numbers = Array.from(
    query.matchAll(
      /(?:\bshelf\s*#?\s*(\d+)\b|(\d+)\s*(?:번째|번\s*째|번|단)?\s*선반|선반\s*(\d+)\s*번|\b(\d+)(?:st|nd|rd|th)\s+shelf\b)/gu,
    ),
    (m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]),
  )
  for (const m of query.matchAll(
    /\b(first|second|third|fourth|fifth)\s+shelf\b|(첫|두|세|네|다섯)\s*(?:번째|째)?\s*선반/gu,
  )) {
    numbers.push(ordinals[m[1] ?? m[2]])
  }
  return [...new Set(numbers)]
}

/** Veto offered bottles that contradict explicit evidence. Never substitute an ID. */
export function verifiedVoiceBlocks(text: string, candidates: VoiceMatch[]): string[] {
  const query = normalize(text),
    form = hydration(query),
    shelves = shelfNumbers(query)
  const casMentions = Array.from(query.matchAll(/(?<!\d)\d{2,7}-\d{2}-\d(?!\d)/gu), (m) => normalizeCasNumber(m[0]))
  const cas = [...new Set(casMentions)]
  const labels = cas.length
    ? [...new Set(candidates.map((m) => normalize(m.name)))].filter((name) => mentionsLabel(query, name))
    : []
  const named = labels.filter((name) => !labels.some((other) => other !== name && mentionsLabel(other, name)))
  const ambiguous =
    shelves.length > 1 ||
    cas.length > 1 ||
    cas.includes(null) ||
    named.length > 1 ||
    form === 'ambiguous' ||
    ((shelves.length > 0 || cas.length > 0 || form !== null) &&
      /\b(?:not|except|exclude|excluding|instead|either|or|between)\b|말고|제외|아닌|아니라|않은|또는|혹은|대신|부터|(?:^|\s)사이(?:에서|에|의)?(?=$|[\s,.?!])|[0-9]\s*[-~–]\s*[0-9]+\s*(?:번|번째)?\s*선반|\bshelf\s*\d+\s*[-~/]\s*\d+/u.test(
        query,
      ))
  return candidates
    .filter((m) => {
      if (ambiguous) return true
      if (shelves.length && (m.shelfLevel === undefined || m.shelfLevel + 1 !== shelves[0])) return true
      if (
        cas.length &&
        (normalizeCasNumber(m.casNumber) !== cas[0] || (named.length && normalize(m.name) !== named[0]))
      )
        return true
      const labelForm = form === null ? null : hydration(normalize(m.name))
      if (form === null || labelForm === null || labelForm === form) return false
      return (
        labelForm === 'ambiguous' ||
        form === 'dry' ||
        labelForm === 'dry' ||
        (typeof form === 'number' && typeof labelForm === 'number')
      )
    })
    .map((m) => m.source + ':' + m.id)
}
