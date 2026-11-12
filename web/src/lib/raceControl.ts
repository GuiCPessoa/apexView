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

/** Mensagens a mostrar, da mais recente para a mais antiga. `now` null = todas (sem replay). */
export function visibleMessages(
  messages: RaceControlMessage[],
  now: number | null,
  kinds: ReadonlySet<RcKind>,
): RaceControlMessage[] {
  const out: RaceControlMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (now != null && m.time > now) continue
    if (kinds.has(rcKind(m))) out.push(m)
  }
  return out
}

/** Quantas mensagens de cada tipo (até `now`), para os rótulos dos filtros. */
export function countByKind(messages: RaceControlMessage[], now: number | null): Record<RcKind, number> {
  const out = Object.fromEntries(RC_KINDS.map((k) => [k.kind, 0])) as Record<RcKind, number>
  for (const m of messages) if (now == null || m.time <= now) out[rcKind(m)]++
  return out
}

/** Classe CSS da etiqueta da bandeira: "DOUBLE YELLOW" -> "rc-double-yellow". */
export function flagClass(flag: string): string {
  return `rc-${flag.toLowerCase().replace(/\s+/g, '-')}`
}
