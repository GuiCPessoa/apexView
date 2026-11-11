import type { DriverPositions, DriverResult, Lap, Track, TrackStatusChange, TrackStatusCode } from '../types/data'

// ---------- Projeção do mapa ----------

export interface Projection {
  project: (x: number, y: number) => [number, number]
  viewBox: string
  size: number // maior dimensão do mapa, em metros (base para raios e fontes)
}

/** Gira para a orientação oficial e inverte o Y (dados com Y para cima, SVG com Y para baixo). */
export function makeProjection(track: Track, padding = 0.06): Projection {
  const a = (track.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const project = (x: number, y: number): [number, number] => [x * cos - y * sin, -(x * sin + y * cos)]

  const pts = track.outline.map(([x, y]) => project(x, y))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const size = Math.max(maxX - minX, maxY - minY)
  const pad = size * padding
  return {
    project,
    size,
    viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
  }
}

// ---------- Posições ----------

/** Posição interpolada no tempo t (segundos de sessão), ou null sem dado. */
export function positionAt(p: DriverPositions, t: number): [number, number] | null {
  const f = (t - p.start) * p.hz
  if (f < 0 || f > p.x.length - 1) return null
  const i = Math.floor(f)
  const k = f - i
  const x0 = p.x[i]
  const y0 = p.y[i]
  if (x0 == null || y0 == null) return null
  const x1 = p.x[i + 1] ?? x0
  const y1 = p.y[i + 1] ?? y0
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]
}

/** Fração média de amostras com posição conhecida (0–1). Baixa quando o feed falhou. */
export function positionCoverage(positions: DriverPositions[]): number {
  if (positions.length === 0) return 0
  let sum = 0
  for (const p of positions) {
    const known = p.x.reduce((n: number, v) => n + (v != null ? 1 : 0), 0)
    sum += p.x.length ? known / p.x.length : 0
  }
  return sum / positions.length
}

// ---------- Bandeiras ----------

export const TRACK_STATUS_LABEL: Record<TrackStatusCode | 'chequered', string> = {
  green: 'Bandeira verde',
  yellow: 'Bandeira amarela',
  sc: 'Safety car',
  red: 'Bandeira vermelha',
  vsc: 'Safety car virtual',
  vsc_ending: 'Fim do VSC',
  unknown: 'Status desconhecido',
  chequered: 'Bandeira quadriculada',
}

export function statusAt(changes: TrackStatusChange[], t: number): TrackStatusCode {
  let current: TrackStatusCode = 'green'
  for (const c of changes) {
    if (c.time > t) break
    current = c.status
  }
  return current
}

// ---------- Torre de posições ----------

const RETIRED = new Set(['R', 'D', 'E', 'W', 'F', 'N'])

export interface RaceModel {
  totalLaps: number
  /** firstEnd[n] = momento em que o primeiro carro completou a volta n */
  firstEnd: number[]
  drivers: DriverModel[]
}

interface DriverModel {
  result: DriverResult
  laps: Lap[] // ordenadas por número, só com endTime
  allLaps: Map<number, Lap>
  pitWindows: [number, number][]
  lastEnd: number
  retired: boolean
}

export function buildRaceModel(laps: Lap[], results: DriverResult[]): RaceModel {
  const firstEnd: number[] = []
  let totalLaps = 0
  for (const l of laps) {
    if (l.lap == null || l.endTime == null) continue
    totalLaps = Math.max(totalLaps, l.lap)
    if (firstEnd[l.lap] == null || l.endTime < firstEnd[l.lap]) firstEnd[l.lap] = l.endTime
  }

  const drivers = results.map((result) => {
    const mine = laps.filter((l) => l.driver === result.driver && l.lap != null)
    const allLaps = new Map(mine.map((l) => [l.lap!, l]))
    const timed = mine.filter((l) => l.endTime != null).sort((a, b) => a.lap! - b.lap!)
    const pitWindows: [number, number][] = []
    for (const l of mine) {
      if (l.pitInTime == null) continue
      const out = allLaps.get(l.lap! + 1)?.pitOutTime ?? l.pitInTime + 40
      pitWindows.push([l.pitInTime, out])
    }
    return {
      result,
      laps: timed,
      allLaps,
      pitWindows,
      lastEnd: timed.length ? timed[timed.length - 1].endTime! : -Infinity,
      retired: RETIRED.has(result.classifiedPosition ?? ''),
    }
  })
  return { totalLaps, firstEnd, drivers }
}

/** Voltas completas do líder no tempo t. */
export function leaderLapsAt(model: RaceModel, t: number): number {
  let n = 0
  while (n + 1 <= model.totalLaps && model.firstEnd[n + 1] != null && model.firstEnd[n + 1] <= t) n++
  return n
}

export interface TowerRow {
  driver: string
  teamColor: string | null
  position: number
  completed: number
  gap: string
  compound: string | null
  inPit: boolean
  out: boolean // abandonou
  finished: boolean
}

export function towerAt(model: RaceModel, t: number): TowerRow[] {
  const rows = model.drivers.map((d) => {
    let completed = 0
    let lastEnd = -Infinity
    for (const l of d.laps) {
      if (l.endTime! > t) break
      completed = l.lap!
      lastEnd = l.endTime!
    }
    const current = d.allLaps.get(completed + 1) ?? d.allLaps.get(completed)
    return {
      d,
      completed,
      lastEnd,
      compound: current?.compound ?? null,
      inPit: d.pitWindows.some(([a, b]) => t >= a && t <= b),
      out: d.retired && t > d.lastEnd + 30,
      finished: completed > 0 && completed === d.laps[d.laps.length - 1]?.lap && !d.retired && t >= d.lastEnd,
    }
  })

  const grid = (r: (typeof rows)[number]) => r.d.result.gridPosition || 99 // 0 = pit lane, larga por último
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1
    if (a.out && b.out) return b.d.lastEnd - a.d.lastEnd
    if (a.completed !== b.completed) return b.completed - a.completed
    if (a.completed === 0) return grid(a) - grid(b)
    return a.lastEnd - b.lastEnd
  })

  return rows.map((r, i) => {
    let gap = ''
    if (r.out) gap = 'Abandono'
    else if (i === 0) gap = r.completed === 0 ? '' : 'Líder'
    else if (r.completed > 0) {
      const lapped = leaderLapsAt(model, r.lastEnd) - r.completed
      gap = lapped >= 1 ? `+${lapped} V` : `+${(r.lastEnd - model.firstEnd[r.completed]).toFixed(1)}`
    }
    return {
      driver: r.d.result.driver,
      teamColor: r.d.result.teamColor,
      position: i + 1,
      completed: r.completed,
      gap,
      compound: r.compound,
      inPit: r.inPit && !r.out,
      out: r.out,
      finished: r.finished,
    }
  })
}

/** "1:05:09" ou "5:09" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
