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
  /** null quando só um piloto é mostrado */
  b: Channels | null
  /** tempo de B menos tempo de A na mesma distância (s). Positivo = B atrás. null sem B. */
  delta: number[] | null
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

/**
 * Relógio da volta: tempo (s) por distância (m), com as duas pontas fechadas.
 *
 * A primeira amostra do carro vem alguns metros depois da linha (até ~0,3 s) e a última, antes
 * dela. Sem fechar as pontas, o tempo "parado" no começo distorce a diferença entre duas voltas
 * logo na largada e no fim. Por isso a volta começa em (0 m, 0 s) e termina no tempo oficial,
 * com a distância final estimada pela última velocidade. `length` é a distância total da volta.
 */
export interface LapClock {
  d: number[]
  t: number[]
  length: number
}

export function lapClock(lap: LapTelemetry, minSamples = 2): LapClock | null {
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
  if (d.length < minSamples) return null
  if (d[0] > 0 && t[0] > 0) {
    d.unshift(0)
    t.unshift(0)
  }
  const last = d.length - 1
  if (lap.lapTime != null && lap.lapTime > t[last]) {
    const speed = lap.speed[lap.speed.length - 1] ?? 0
    d.push(d[last] + (Math.max(speed, 0) / 3.6) * (lap.lapTime - t[last]))
    t.push(lap.lapTime)
  }
  const length = d[d.length - 1]
  return length > 0 ? { d, t, length } : null
}

/** Canais de uma volta na grade; `scale` estica as distâncias da volta (para alinhar com outra). */
function channelsOn(lap: LapTelemetry, grid: number[], clock: LapClock | null, scale = 1): Channels {
  const xs = scale === 1 ? lap.d : lap.d.map((x) => x * scale)
  return {
    t: clock ? interpLinear(scale === 1 ? clock.d : clock.d.map((x) => x * scale), clock.t, grid) : interpLinear(xs, lap.t, grid),
    speed: interpLinear(xs, lap.speed, grid),
    throttle: interpLinear(xs, lap.throttle, grid),
    brake: interpStep(xs, lap.brake, grid),
    gear: interpStep(xs, lap.gear, grid),
    drs: interpStep(xs, lap.drs, grid),
  }
}

/**
 * Alinha as voltas numa grade de distância. Sem `b`, prepara só a volta de A (um piloto).
 *
 * A distância vem da integração da velocidade, então duas voltas completas terminam com alguns
 * metros de diferença. A volta de B é esticada para ter o comprimento da de A: assim os mesmos
 * pontos da pista ficam alinhados e a diferença no fim é exatamente a diferença dos tempos de volta.
 */
export function compareLaps(a: LapTelemetry, b: LapTelemetry | null, step = 5): Comparison {
  const clockA = lapClock(a)
  const clockB = b ? lapClock(b) : null
  const scaleB = clockA && clockB ? clockA.length / clockB.length : 1
  const lastA = clockA ? clockA.length : a.d[a.d.length - 1]
  const end = b && !(clockA && clockB) ? Math.min(lastA, b.d[b.d.length - 1]) : lastA
  const d: number[] = []
  for (let x = 0; x <= end; x += step) d.push(x)
  const ca = channelsOn(a, d, clockA)
  if (!b) return { d, a: ca, b: null, delta: null }
  const cb = channelsOn(b, d, clockB, scaleB)
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
