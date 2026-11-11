import type { DriverResult, Lap } from '../types/data'

export interface RaceDriver {
  driver: string
  fullName: string | null
  team: string | null
  color: string
  dashed: boolean // 2º piloto da equipe: linha tracejada
  finish: number | null
  classified: string | null
}

/** Pilotos na ordem de chegada, com cor e traço (companheiros de equipe se distinguem pelo traço). */
export function raceDrivers(results: DriverResult[]): RaceDriver[] {
  const seenTeam = new Set<string>()
  return [...results]
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .map((r) => {
      const team = r.team ?? r.driver
      const dashed = seenTeam.has(team)
      seenTeam.add(team)
      return {
        driver: r.driver,
        fullName: r.fullName,
        team: r.team,
        color: r.teamColor ?? '#888888',
        dashed,
        finish: r.position,
        classified: r.classifiedPosition,
      }
    })
}

export function totalLaps(laps: Lap[]): number {
  return laps.reduce((m, l) => Math.max(m, l.lap ?? 0), 0)
}

function lapsOf(laps: Lap[], driver: string): Map<number, Lap> {
  return new Map(laps.filter((l) => l.driver === driver && l.lap != null).map((l) => [l.lap!, l]))
}

/**
 * Posição ao fim de cada volta. Índice 0 = largada (grid; quem larga do pit lane fica em último).
 * null depois que o piloto para de completar voltas.
 */
export function positionsByLap(laps: Lap[], results: DriverResult[]): Map<string, (number | null)[]> {
  const n = totalLaps(laps)
  const out = new Map<string, (number | null)[]>()
  for (const r of results) {
    const mine = lapsOf(laps, r.driver)
    const row: (number | null)[] = [r.gridPosition ? r.gridPosition : results.length]
    for (let lap = 1; lap <= n; lap++) row.push(mine.get(lap)?.position ?? null)
    out.set(r.driver, row)
  }
  return out
}

/** Diferença para o líder (s) ao fim de cada volta: tempo do piloto menos o do primeiro a completar a volta. */
export function gapsByLap(laps: Lap[], drivers: string[]): Map<string, (number | null)[]> {
  const n = totalLaps(laps)
  const firstEnd: number[] = []
  for (const l of laps) {
    if (l.lap == null || l.endTime == null) continue
    if (firstEnd[l.lap] == null || l.endTime < firstEnd[l.lap]) firstEnd[l.lap] = l.endTime
  }
  const out = new Map<string, (number | null)[]>()
  for (const d of drivers) {
    const mine = lapsOf(laps, d)
    const row: (number | null)[] = [0]
    for (let lap = 1; lap <= n; lap++) {
      const end = mine.get(lap)?.endTime
      row.push(end != null && firstEnd[lap] != null ? Math.round((end - firstEnd[lap]) * 1000) / 1000 : null)
    }
    out.set(d, row)
  }
  return out
}

export interface Stint {
  stint: number
  compound: string | null
  fresh: boolean | null
  startLap: number
  endLap: number
  startLife: number | null // voltas que o pneu já tinha ao começar o stint
}

export function stintsOf(laps: Lap[], driver: string): Stint[] {
  const mine = [...lapsOf(laps, driver).values()].sort((a, b) => a.lap! - b.lap!)
  const out: Stint[] = []
  for (const l of mine) {
    const key = l.stint ?? 0
    const last = out[out.length - 1]
    if (last && last.stint === key && last.compound === l.compound) {
      last.endLap = l.lap!
    } else {
      out.push({
        stint: key,
        compound: l.compound,
        fresh: l.freshTyre,
        startLap: l.lap!,
        endLap: l.lap!,
        startLife: l.tyreLife != null ? l.tyreLife - 1 : null,
      })
    }
  }
  return out
}

export interface PitStop {
  driver: string
  lap: number // volta em que entrou nos boxes
  pitLaneTime: number | null // entrada à saída do pit lane (s); null se não saiu (abandono)
  from: string | null
  to: string | null
}

export function pitStops(laps: Lap[], drivers: string[]): PitStop[] {
  const out: PitStop[] = []
  for (const d of drivers) {
    const mine = lapsOf(laps, d)
    for (const [lapNo, l] of mine) {
      if (l.pitInTime == null) continue
      const next = mine.get(lapNo + 1)
      out.push({
        driver: d,
        lap: lapNo,
        pitLaneTime: next?.pitOutTime != null ? Math.round((next.pitOutTime - l.pitInTime) * 1000) / 1000 : null,
        from: l.compound,
        to: next?.compound ?? null,
      })
    }
  }
  return out.sort((a, b) => a.lap - b.lap || a.driver.localeCompare(b.driver))
}

export type Neutralization = 'sc' | 'vsc' | 'red'

/** Voltas com safety car, VSC ou bandeira vermelha (a partir do trackStatus de cada volta). */
export function neutralizedLaps(laps: Lap[]): Map<number, Neutralization> {
  const out = new Map<number, Neutralization>()
  const rank: Record<Neutralization, number> = { vsc: 1, sc: 2, red: 3 }
  for (const l of laps) {
    if (l.lap == null || !l.trackStatus) continue
    let kind: Neutralization | null = null
    if (l.trackStatus.includes('5')) kind = 'red'
    else if (l.trackStatus.includes('4')) kind = 'sc'
    else if (/[67]/.test(l.trackStatus)) kind = 'vsc'
    if (!kind) continue
    const cur = out.get(l.lap)
    if (!cur || rank[kind] > rank[cur]) out.set(l.lap, kind)
  }
  return out
}
