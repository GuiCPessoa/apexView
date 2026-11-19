import type { Lap, LapTelemetry } from '../types/data'
import { isValidLap } from './session'
import { lapClock, similarColors, type LapClock } from './telemetry'

/**
 * Mini setores dominantes: a volta é dividida em N trechos iguais e cada trecho fica com
 * quem passou por ele em menos tempo.
 *
 * Cada volta é medida em fração da própria distância (0 = linha de chegada, 1 = volta completa),
 * porque a distância integrada da velocidade varia alguns metros de piloto para piloto. As pontas
 * de cada volta são fechadas por `lapClock` (lib/telemetry).
 */

/** Diferenças menores que isso (s) contam como empate: a telemetria (~4 Hz) não separa. */
export const TIE_S = 0.01
export const SECTOR_COUNTS = [10, 25, 50] as const
export const DEFAULT_SECTORS = 25
/** Amostras mínimas para usar uma volta (menos que isso é volta sem dados do carro). */
const MIN_SAMPLES = 10
/** Pilotos comparados ao mesmo tempo. */
export const MAX_DRIVERS = 3

/** Tempo (s) em que a volta passou pela fração `x` da própria distância (interpolação linear). */
export function timeAt(clock: LapClock, x: number): number {
  const { d, t } = clock
  const g = x * clock.length
  if (g <= d[0]) return t[0]
  if (g >= d[d.length - 1]) return t[t.length - 1]
  let lo = 0
  let hi = d.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (d[mid] <= g) lo = mid
    else hi = mid
  }
  const k = (g - d[lo]) / (d[hi] - d[lo] || 1)
  return t[lo] + (t[hi] - t[lo]) * k
}

export interface MiniSector {
  index: number
  /** Início e fim do trecho, em fração da volta. */
  from: number
  to: number
  /** Tempo de cada piloto no trecho (s), do mais rápido ao mais lento. */
  ranking: { driver: string; time: number }[]
  /** Mais rápido no trecho; null em empate (diferença menor que `tie`). */
  winner: string | null
}

export interface MiniSectorSummary {
  sectors: MiniSector[]
  /** Fração da volta dominada por piloto (0..1). */
  share: Record<string, number>
  /** Trechos vencidos por piloto. */
  count: Record<string, number>
  /** Fração da volta em empate. */
  tieShare: number
}

/** Divide as voltas em `n` trechos iguais e acha o mais rápido de cada um. */
export function miniSectors(
  laps: { driver: string; lap: LapTelemetry }[],
  n: number = DEFAULT_SECTORS,
  tie: number = TIE_S,
): MiniSectorSummary {
  const clocks = laps
    .map(({ driver, lap }) => ({ driver, clock: lapClock(lap, MIN_SAMPLES) }))
    .filter((c): c is { driver: string; clock: LapClock } => c.clock != null)
  const share: Record<string, number> = {}
  const count: Record<string, number> = {}
  for (const { driver } of clocks) {
    share[driver] = 0
    count[driver] = 0
  }
  let tieShare = 0
  const sectors: MiniSector[] = []
  if (clocks.length === 0 || n < 1) return { sectors, share, count, tieShare }

  for (let i = 0; i < n; i++) {
    const from = i / n
    const to = (i + 1) / n
    const ranking = clocks
      .map(({ driver, clock }) => ({ driver, time: timeAt(clock, to) - timeAt(clock, from) }))
      .sort((a, b) => a.time - b.time)
    const tied = ranking.length > 1 && ranking[1].time - ranking[0].time < tie
    const winner = tied ? null : ranking[0].driver
    if (winner) {
      share[winner] += to - from
      count[winner] += 1
    } else tieShare += to - from
    sectors.push({ index: i, from, to, ranking, winner })
  }
  return { sectors, share, count, tieShare }
}

/** Pilotos padrão: os em foco e, completando até `max`, os donos das voltas mais rápidas. */
export function defaultDrivers(focus: string[], laps: Lap[], available: string[], max = MAX_DRIVERS): string[] {
  const best = new Map<string, number>()
  for (const l of laps) {
    if (!isValidLap(l) || !available.includes(l.driver)) continue
    const prev = best.get(l.driver)
    if (prev == null || l.lapTime! < prev) best.set(l.driver, l.lapTime!)
  }
  const fastest = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d)
  const pool = [...focus.filter((d) => available.includes(d)), ...fastest]
  return [...new Set(pool)].slice(0, max)
}

/** Mistura uma cor hex (#rrggbb) com branco: k = 0 mantém, 1 vira branco. */
export function lighten(hex: string, k: number): string {
  const h = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return hex
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return `#${rgb.map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Cor de cada piloto no mapa: a da equipe; quem tem cor parecida com a de um piloto anterior
 * (companheiro de equipe) ganha um tom bem mais claro.
 */
export function driverColors(drivers: string[], teamColor: (driver: string) => string): Record<string, string> {
  const out: Record<string, string> = {}
  const used: string[] = []
  for (const d of drivers) {
    const base = teamColor(d)
    out[d] = used.some((c) => similarColors(c, base)) ? lighten(base, 0.72) : base
    used.push(base)
  }
  return out
}
