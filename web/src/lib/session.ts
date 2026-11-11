import type { DriverResult, Lap } from '../types/data'

/** Volta válida para ranking: tem tempo e não foi anulada. */
export function isValidLap(l: Lap): boolean {
  return l.lapTime != null && l.deleted !== true
}

export interface RankingRow {
  driver: string
  best: Lap | null
  gap: number | null // para o mais rápido
  interval: number | null // para o carro à frente
  laps: number // voltas completadas (com tempo)
  bestSectors: [number | null, number | null, number | null]
  ideal: number | null // soma dos melhores setores
  topSpeed: number | null
}

const minOf = (values: (number | null | undefined)[]): number | null => {
  let m: number | null = null
  for (const v of values) if (v != null && (m == null || v < m)) m = v
  return m
}

/** Ranking pela melhor volta válida (treinos e classificação). Quem não marcou tempo vai para o fim. */
export function rankingByBestLap(laps: Lap[], drivers: string[]): RankingRow[] {
  const rows = drivers.map((driver): RankingRow => {
    const mine = laps.filter((l) => l.driver === driver)
    const valid = mine.filter(isValidLap)
    const best = valid.reduce<Lap | null>((b, l) => (!b || l.lapTime! < b.lapTime! ? l : b), null)
    const bestSectors: RankingRow['bestSectors'] = [
      minOf(valid.map((l) => l.sector1)),
      minOf(valid.map((l) => l.sector2)),
      minOf(valid.map((l) => l.sector3)),
    ]
    const ideal = bestSectors.every((s) => s != null)
      ? Math.round((bestSectors[0]! + bestSectors[1]! + bestSectors[2]!) * 1000) / 1000
      : null
    return {
      driver,
      best,
      gap: null,
      interval: null,
      laps: mine.filter((l) => l.lapTime != null).length,
      bestSectors,
      ideal,
      topSpeed: mine.reduce<number | null>((m, l) => (l.speedTrap != null && (m == null || l.speedTrap > m) ? l.speedTrap : m), null),
    }
  })
  rows.sort((a, b) => (a.best?.lapTime ?? Infinity) - (b.best?.lapTime ?? Infinity))
  const top = rows[0]?.best?.lapTime ?? null
  rows.forEach((r, i) => {
    if (r.best?.lapTime == null || top == null) return
    r.gap = r.best.lapTime - top
    const prev = rows[i - 1]?.best?.lapTime
    r.interval = prev != null ? r.best.lapTime - prev : null
  })
  return rows
}

/** Melhor tempo de cada setor na sessão (para pintar de roxo). */
export function sessionBestSectors(rows: RankingRow[]): [number | null, number | null, number | null] {
  return [0, 1, 2].map((i) => minOf(rows.map((r) => r.bestSectors[i]))) as [number | null, number | null, number | null]
}

export interface Segment {
  n: number
  start: number
  end: number
}

/**
 * Janela de cada segmento da classificação (Q1/Q2/Q3), pelos tempos de sessão das voltas.
 * Não usa startTime: na volta de saída dos boxes ele vale o fim da volta anterior (de antes
 * de o carro ficar parado na garagem). O início real é a saída do pit lane.
 */
export function qualifyingSegments(laps: Lap[]): Segment[] {
  const by = new Map<number, Segment>()
  for (const l of laps) {
    if (l.segment == null) continue
    const start = l.pitOutTime ?? l.endTime
    const end = l.endTime ?? l.pitOutTime
    if (start == null || end == null) continue
    const s = by.get(l.segment)
    if (!s) by.set(l.segment, { n: l.segment, start, end })
    else {
      s.start = Math.min(s.start, start)
      s.end = Math.max(s.end, end)
    }
  }
  return [...by.values()].sort((a, b) => a.n - b.n)
}

/** Em que segmento o piloto foi eliminado (1 ou 2), ou 3 se chegou ao Q3. */
export function reachedSegment(r: DriverResult): 1 | 2 | 3 {
  if (r.q3 != null) return 3
  if (r.q2 != null) return 2
  return 1
}

export interface EvolutionPoint {
  driver: string
  time: number // segundos de sessão no fim da volta
  lapTime: number
  compound: string | null
  lap: number
}

/**
 * Voltas "de verdade" para o gráfico de evolução: válidas, sem entrada/saída de box
 * e até `cutoff` × melhor volta da sessão (exclui voltas de resfriamento e de aquecimento).
 */
export function evolutionPoints(laps: Lap[], cutoff = 1.07): EvolutionPoint[] {
  const valid = laps.filter((l) => isValidLap(l) && !l.pitIn && !l.pitOut && l.endTime != null && l.lap != null)
  const best = minOf(valid.map((l) => l.lapTime))
  if (best == null) return []
  return valid
    .filter((l) => l.lapTime! <= best * cutoff)
    .map((l) => ({ driver: l.driver, time: l.endTime!, lapTime: l.lapTime!, compound: l.compound, lap: l.lap! }))
    .sort((a, b) => a.time - b.time)
}
