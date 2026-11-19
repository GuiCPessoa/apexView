import type { Lap, LapTelemetry } from '../types/data'
import { isValidLap } from './session'
import { similarColors } from './telemetry'

/**
 * Mini setores dominantes: a volta é dividida em N trechos iguais e cada trecho fica com
 * quem passou por ele em menos tempo.
 *
 * Cada volta é medida em fração da própria distância (0 = linha de chegada, 1 = volta completa),
 * porque a distância integrada da velocidade varia alguns metros de piloto para piloto.
 */

/** Diferenças menores que isso (s) contam como empate: a telemetria (~4 Hz) não separa. */
export const TIE_S = 0.01
export const SECTOR_COUNTS = [10, 25, 50] as const
export const DEFAULT_SECTORS = 25
/** Pilotos comparados ao mesmo tempo. */
export const MAX_DRIVERS = 3

/** Relógio da volta: tempo (s) em função da fração da volta, com as duas pontas fechadas. */
export interface LapClock {
  f: number[] // fração da volta, 0..1, crescente
  t: number[] // tempo desde a linha (s)
}

/**
 * Monta o relógio da volta a partir das amostras do carro.
 *
 * A primeira amostra vem alguns metros depois da linha (e a última, antes dela); sem fechar as
 * pontas, o primeiro e o último trecho ganhariam ou perderiam até 0,3 s. Por isso a volta começa
 * em (0 m, 0 s) e termina no tempo oficial, com a distância final estimada pela última velocidade.
 */
export function lapClock(lap: LapTelemetry): LapClock | null {
  const d: number[] = []
  const t: number[] = []
  for (let i = 0; i < lap.d.length; i++) {
    const di = lap.d[i]
    const ti = lap.t[i]
    if (di == null || ti == null || !Number.isFinite(di) || !Number.isFinite(ti)) continue
    if (d.length && (di <= d[d.length - 1] || ti <= t[t.length - 1])) continue // sem voltar atrás
    d.push(di)
    t.push(ti)
  }
  if (d.length < 10) return null
  if (d[0] > 0 && t[0] > 0) {
    d.unshift(0)
    t.unshift(0)
  }
  const last = d.length - 1
  if (lap.lapTime != null && lap.lapTime > t[last]) {
    const speed = lap.speed[lap.speed.length - 1] ?? 0
    d.push(d[last] + Math.max(speed, 0) / 3.6 * (lap.lapTime - t[last]))
    t.push(lap.lapTime)
  }
  const total = d[d.length - 1]
  if (!(total > 0)) return null
  return { f: d.map((x) => x / total), t }
}

/** Tempo (s) em que a volta passou pela fração `x` (interpolação linear). */
export function timeAt(clock: LapClock, x: number): number {
  const { f, t } = clock
  if (x <= f[0]) return t[0]
  if (x >= f[f.length - 1]) return t[t.length - 1]
  let lo = 0
  let hi = f.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (f[mid] <= x) lo = mid
    else hi = mid
  }
  const k = (x - f[lo]) / (f[hi] - f[lo] || 1)
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
    .map(({ driver, lap }) => ({ driver, clock: lapClock(lap) }))
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
