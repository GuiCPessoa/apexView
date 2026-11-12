import type { RaceControlMessage } from '../types/data'

/** Tipo de mensagem para os filtros do feed da direção de prova. */
export type RcKind = 'flag' | 'blue' | 'sc' | 'stewards' | 'track' | 'drs' | 'other'

export const RC_KINDS: { kind: RcKind; label: string }[] = [
  { kind: 'flag', label: 'Bandeiras' },
  { kind: 'sc', label: 'Safety car' },
  { kind: 'stewards', label: 'Comissários' },
  { kind: 'track', label: 'Limites de pista' },
  { kind: 'drs', label: 'DRS' },
  { kind: 'blue', label: 'Bandeiras azuis' },
  { kind: 'other', label: 'Outras' },
]

/** Bandeiras azuis são muitas (metade do feed numa corrida) e ficam escondidas por padrão. */
export const DEFAULT_RC_KINDS: ReadonlySet<RcKind> = new Set(RC_KINDS.map((k) => k.kind).filter((k) => k !== 'blue'))

const STEWARDS = /STEWARDS|PENALTY|INVESTIGAT|NOTED|REPRIMAND|NO FURTHER ACTION|DISQUALIFIED/
const TRACK_LIMITS = /TRACK LIMITS|DELETED|REINSTATED/

export function rcKind(m: RaceControlMessage): RcKind {
  const text = m.message.toUpperCase()
  if (m.flag === 'BLUE') return 'blue'
  if (m.category === 'SafetyCar' || /SAFETY CAR|\bVSC\b/.test(text)) return 'sc'
  if (m.category === 'Drs' || /\bDRS\b/.test(text)) return 'drs'
  if (STEWARDS.test(text)) return 'stewards'
  if (TRACK_LIMITS.test(text)) return 'track'
  if (m.category === 'Flag' || m.flag) return 'flag'
  return 'other'
}

// A classificação usa várias expressões regulares; cada lista de mensagens é classificada uma vez só.
const kindsCache = new WeakMap<RaceControlMessage[], RcKind[]>()

/** Tipo de cada mensagem, na mesma ordem (guardado por lista). */
export function kindsOf(messages: RaceControlMessage[]): RcKind[] {
  let kinds = kindsCache.get(messages)
  if (!kinds) {
    kinds = messages.map(rcKind)
    kindsCache.set(messages, kinds)
  }
  return kinds
}

/** Quantas mensagens já saíram até o instante `t` (mensagens em ordem de tempo; busca binária). */
export function countUntil(messages: RaceControlMessage[], t: number): number {
  let lo = 0
  let hi = messages.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (messages[mid].time <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Mensagens a mostrar, da mais recente para a mais antiga. `count` limita às primeiras
 * mensagens (as que já saíram no replay, de `countUntil`); null = todas.
 */
export function visibleMessages(
  messages: RaceControlMessage[],
  count: number | null,
  kinds: ReadonlySet<RcKind>,
): RaceControlMessage[] {
  const kindOf = kindsOf(messages)
  const out: RaceControlMessage[] = []
  for (let i = Math.min(count ?? messages.length, messages.length) - 1; i >= 0; i--) {
    if (kinds.has(kindOf[i])) out.push(messages[i])
  }
  return out
}

/** Quantas mensagens de cada tipo entre as primeiras `count` (null = todas), para os rótulos dos filtros. */
export function countByKind(messages: RaceControlMessage[], count: number | null): Record<RcKind, number> {
  const kindOf = kindsOf(messages)
  const out = Object.fromEntries(RC_KINDS.map((k) => [k.kind, 0])) as Record<RcKind, number>
  const n = Math.min(count ?? messages.length, messages.length)
  for (let i = 0; i < n; i++) out[kindOf[i]]++
  return out
}

/** Classe CSS da etiqueta da bandeira: "DOUBLE YELLOW" -> "rc-double-yellow". */
export function flagClass(flag: string): string {
  return `rc-${flag.toLowerCase().replace(/\s+/g, '-')}`
}
