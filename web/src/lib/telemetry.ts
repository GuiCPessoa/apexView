import type { Lap, LapTelemetry } from '../types/data'

export interface Channels {
  t: number[]
  speed: number[]
  throttle: number[]
  brake: number[]
  gear: number[]
  drs: number[]
}

export interface Comparison {
  d: number[] // grade de distância comum (m)
  a: Channels
  b: Channels
  /** tempo de B menos tempo de A na mesma distância (s). Positivo = B atrás. */
  delta: number[]
}

/** Interpolação linear; fora do intervalo usa o valor da ponta. `xs` precisa ser crescente. */
export function interpLinear(xs: number[], ys: number[], grid: number[]): number[] {
  const out = new Array<number>(grid.length)
  let j = 0
  for (let i = 0; i < grid.length; i++) {
    const g = grid[i]
    while (j < xs.length - 2 && xs[j + 1] < g) j++
    if (g <= xs[0]) out[i] = ys[0]
    else if (g >= xs[xs.length - 1]) out[i] = ys[ys.length - 1]
    else {
      const k = (g - xs[j]) / (xs[j + 1] - xs[j] || 1)
      out[i] = ys[j] + (ys[j + 1] - ys[j]) * k
    }
  }
  return out
}

/** Degrau: valor da última amostra até a distância (para marcha, freio e DRS). */
export function interpStep(xs: number[], ys: number[], grid: number[]): number[] {
  const out = new Array<number>(grid.length)
  let j = 0
  for (let i = 0; i < grid.length; i++) {
    while (j < xs.length - 1 && xs[j + 1] <= grid[i]) j++
    out[i] = ys[j]
  }
  return out
}

function channelsOn(lap: LapTelemetry, grid: number[]): Channels {
  return {
    t: interpLinear(lap.d, lap.t, grid),
    speed: interpLinear(lap.d, lap.speed, grid),
    throttle: interpLinear(lap.d, lap.throttle, grid),
    brake: interpStep(lap.d, lap.brake, grid),
    gear: interpStep(lap.d, lap.gear, grid),
    drs: interpStep(lap.d, lap.drs, grid),
  }
}

export function compareLaps(a: LapTelemetry, b: LapTelemetry, step = 5): Comparison {
  const end = Math.min(a.d[a.d.length - 1], b.d[b.d.length - 1])
  const d: number[] = []
  for (let x = 0; x <= end; x += step) d.push(x)
  const ca = channelsOn(a, d)
  const cb = channelsOn(b, d)
  return { d, a: ca, b: cb, delta: d.map((_, i) => cb.t[i] - ca.t[i]) }
}

/** Volta mais rápida de um piloto (ou de todos, sem `driver`) segundo laps.json. Ignora voltas anuladas. */
export function fastestLap(laps: Lap[], driver?: string): Lap | null {
  let best: Lap | null = null
  for (const l of laps) {
    if (l.lapTime == null || l.lap == null || l.deleted === true || (driver && l.driver !== driver)) continue
    if (!best || l.lapTime < best.lapTime!) best = l
  }
  return best
}

/** Cores muito parecidas (ex.: dois pilotos da mesma equipe)? */
export function similarColors(c1: string, c2: string): boolean {
  const rgb = (c: string) => {
    const h = c.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const [a, b] = [rgb(c1), rgb(c2)]
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 80
}

/** Cor de texto legível sobre um fundo hex (#rrggbb): escura em fundos claros. */
export function textOn(background: string): string {
  const h = background.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#fff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? '#111' : '#fff'
}
