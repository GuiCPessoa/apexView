// Regras de exibição da aba Ao vivo (painel em blocos): siglas de equipe, mini setores,
// domínio da pista e o par de pilotos das colunas laterais. Tudo puro, para testar.

import type { LiveDominance, LiveDriver } from '../types/live'
import { lighten } from './minisectors'
import { similarColors } from './telemetry'

/** Sigla da equipe na cor dela (no lugar dos logos, que são marcas registradas). */
const TEAM_CODES: [RegExp, string][] = [
  [/mclaren/i, 'MCL'],
  [/ferrari/i, 'FER'],
  [/mercedes/i, 'MER'],
  [/racing bulls|rb f1|alphatauri|visa cash app/i, 'RB'],
  [/red bull/i, 'RBR'],
  [/aston/i, 'AMR'],
  [/alpine/i, 'ALP'],
  [/williams/i, 'WIL'],
  [/haas/i, 'HAA'],
  [/audi|sauber|kick/i, 'AUD'],
  [/cadillac/i, 'CAD'],
]

export function teamCode(team: string | null): string {
  if (!team) return ''
  for (const [re, code] of TEAM_CODES) if (re.test(team)) return code
  return team.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
}

/** Classe CSS da cor de um mini setor (status do feed). */
export function segmentClass(status: number): string {
  switch (status) {
    case 2048:
      return 'seg-y' // não melhorou
    case 2049:
      return 'seg-p' // melhor do piloto
    case 2051:
      return 'seg-o' // melhor da sessão
    case 2064:
      return 'seg-pit'
    default:
      return 'seg-none'
  }
}

/** Ponto do traçado mais próximo de uma posição (índice). */
export function nearestIndex(outline: [number, number][], p: [number, number]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < outline.length; i++) {
    const dx = outline[i][0] - p[0]
    const dy = outline[i][1] - p[1]
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export interface DominanceSpan {
  from: number // índice inicial no traçado
  to: number // índice final (pode passar de n: dá a volta pelo início)
  owner: string | null
  known: boolean // o fim do trecho foi visto (senão, repartido entre os vizinhos)
}

/**
 * Trechos do traçado de cada mini setor. O traçado começa na linha de chegada; o fim de cada
 * mini setor vem das posições observadas. Trechos sem posição dividem igualmente o espaço entre
 * os vizinhos conhecidos; leituras fora de ordem são ignoradas (o fim nunca volta para trás).
 */
export function dominanceSpans(outline: [number, number][], dominance: LiveDominance): DominanceSpan[] {
  const n = outline.length
  const total = dominance.owners.length
  if (n < 3 || total === 0) return []
  // fim de cada trecho como índice "desenrolado" (0..n), crescente
  const ends: (number | null)[] = dominance.ends.map((p) => (p ? nearestIndex(outline, p) : null))
  ends[total - 1] = n // o último termina na linha
  let last = 0
  for (let g = 0; g < total; g++) {
    const e = ends[g]
    if (e == null) continue
    // perto do fim, o índice pode ter dado a volta (ex.: 2 de 444): conta como n + 2
    const unwrapped = e < last && last - e > n / 2 ? e + n : e
    if (unwrapped <= last || unwrapped > n) ends[g] = null
    else last = ends[g] = unwrapped
  }
  ends[total - 1] = n
  // preenche os desconhecidos dividindo o espaço entre os conhecidos
  const out: DominanceSpan[] = []
  let prevEnd = 0
  let g = 0
  while (g < total) {
    let h = g
    while (ends[h] == null) h++
    const stop = ends[h]!
    const count = h - g + 1
    for (let k = 0; k < count; k++) {
      const from = prevEnd + ((stop - prevEnd) * k) / count
      const to = prevEnd + ((stop - prevEnd) * (k + 1)) / count
      out.push({ from: Math.round(from), to: Math.round(to), owner: dominance.owners[g + k], known: g + k === h && dominance.ends[g + k] != null })
    }
    prevEnd = stop
    g = h + 1
  }
  return out
}

/** Mini setores dominados por piloto, do que tem mais para o que tem menos. */
export function dominanceCount(dominance: LiveDominance): { driver: string; count: number }[] {
  const count = new Map<string, number>()
  for (const o of dominance.owners) if (o) count.set(o, (count.get(o) ?? 0) + 1)
  return [...count.entries()].map(([driver, c]) => ({ driver, count: c })).sort((a, b) => b.count - a.count || a.driver.localeCompare(b.driver))
}

/**
 * Cor por piloto: a da equipe; o companheiro de equipe (o mais atrás na torre) em tom claro.
 * Equipes diferentes com cores parecidas ficam com a cor delas (o tom claro é só para companheiros).
 */
export function liveDriverColors(drivers: Pick<LiveDriver, 'driver' | 'team' | 'teamColor'>[]): Map<string, string> {
  const out = new Map<string, string>()
  const seen: { team: string | null; color: string }[] = []
  for (const d of drivers) {
    const base = d.teamColor ?? '#8b8b97'
    const mate = seen.some((x) => (x.team && d.team ? x.team === d.team : similarColors(x.color, base)))
    out.set(d.driver, mate ? lighten(base, 0.6) : base)
    seen.push({ team: d.team, color: base })
  }
  return out
}

/** Direção do vento em pontos cardeais (graus de onde vem, como o feed). */
export function windLabel(degrees: number | null): string {
  if (degrees == null) return ''
  return ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round((((degrees % 360) + 360) % 360) / 45) % 8]
}

/** Diferença da torre ("+0.066", "+1 V"); vazio vira "—". */
export function decimal(text: string | null | undefined): string {
  return text || '—'
}
