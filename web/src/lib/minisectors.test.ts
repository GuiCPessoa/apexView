import { describe, expect, it } from 'vitest'
import type { Lap, LapTelemetry } from '../types/data'
import { defaultDrivers, driverColors, lighten, loadChoice, miniSectors, saveChoice, timeAt } from './minisectors'
import { lapClock } from './telemetry'

/** Volta de 1000 m: `pace(x)` dá a velocidade (m/s) na fração x; amostras a cada `every` s. */
function makeLap(pace: (x: number) => number, opts: { offset?: number; every?: number } = {}): LapTelemetry {
  const every = opts.every ?? 0.25
  const d: number[] = []
  const t: number[] = []
  const speed: number[] = []
  let dist = 0
  let time = 0
  const dt = 0.001
  let next = opts.offset ?? every
  while (dist < 1000) {
    const v = pace(dist / 1000)
    dist += v * dt
    time += dt
    if (time >= next && dist < 1000) {
      d.push(dist)
      t.push(time)
      speed.push(v * 3.6)
      next += every
    }
  }
  const zeros = d.map(() => 0)
  return { lap: 1, lapTime: time, compound: null, d, t, speed, throttle: zeros, brake: zeros, gear: zeros, drs: zeros }
}

describe('lapClock', () => {
  it('fecha a volta em (0, 0) e no tempo oficial', () => {
    const lap = makeLap(() => 50, { offset: 0.3 })
    const clock = lapClock(lap)!
    expect(clock.d[0]).toBe(0)
    expect(clock.t[0]).toBe(0)
    expect(clock.length).toBeCloseTo(1000, 0)
    expect(clock.t[clock.t.length - 1]).toBeCloseTo(lap.lapTime!, 6)
    expect(timeAt(clock, 0.5)).toBeCloseTo(10, 1)
  })

  it('ignora amostras vazias ou fora de ordem e recusa voltas sem dados', () => {
    const lap = makeLap(() => 50)
    const broken = { ...lap, d: [...lap.d], t: [...lap.t] }
    broken.d[5] = null as unknown as number
    broken.d[8] = broken.d[7] - 1
    expect(lapClock(broken)).not.toBeNull()
    expect(lapClock({ ...lap, d: lap.d.slice(0, 3), t: lap.t.slice(0, 3) }, 10)).toBeNull()
  })
})

describe('miniSectors', () => {
  // A é mais rápido na primeira metade, B na segunda
  const a = makeLap((x) => (x < 0.5 ? 60 : 50))
  const b = makeLap((x) => (x < 0.5 ? 50 : 60), { offset: 0.1 })

  it('dá cada trecho ao mais rápido e soma a fração dominada', () => {
    const s = miniSectors([{ driver: 'AAA', lap: a }, { driver: 'BBB', lap: b }], 10)
    expect(s.sectors).toHaveLength(10)
    expect(s.sectors.slice(0, 5).every((x) => x.winner === 'AAA')).toBe(true)
    expect(s.sectors.slice(5).every((x) => x.winner === 'BBB')).toBe(true)
    expect(s.share.AAA).toBeCloseTo(0.5)
    expect(s.count).toEqual({ AAA: 5, BBB: 5 })
    expect(s.tieShare).toBe(0)
    expect(s.sectors[0].ranking[0].driver).toBe('AAA')
  })

  it('a amostra atrasada da largada não distorce o primeiro trecho', () => {
    const late = makeLap(() => 50, { offset: 0.32 })
    const early = makeLap(() => 50, { offset: 0.01 })
    const s = miniSectors([{ driver: 'LAT', lap: late }, { driver: 'EAR', lap: early }], 25)
    expect(s.sectors.every((x) => x.winner === null)).toBe(true)
    expect(s.tieShare).toBeCloseTo(1)
  })

  it('diferença menor que a tolerância é empate', () => {
    const c = makeLap((x) => (x < 0.5 ? 60.01 : 50))
    const s = miniSectors([{ driver: 'AAA', lap: a }, { driver: 'CCC', lap: c }], 2)
    expect(s.sectors[0].winner).toBeNull()
  })

  it('sem voltas válidas não há trechos', () => {
    expect(miniSectors([], 25).sectors).toEqual([])
  })
})

describe('defaultDrivers', () => {
  const lap = (driver: string, lapTime: number | null, deleted = false) => ({ driver, lap: 1, lapTime, deleted }) as Lap
  const laps = [lap('VER', 80), lap('HAM', 79, true), lap('HAM', 81), lap('LEC', 80.5), lap('NOR', 82), lap('PIA', null)]

  it('começa com os dois donos das voltas mais rápidas (válidas)', () => {
    expect(defaultDrivers(laps, ['VER', 'HAM', 'LEC', 'NOR'])).toEqual(['VER', 'LEC'])
  })

  it('só quem tem telemetria', () => {
    expect(defaultDrivers(laps, ['NOR', 'PIA', 'HAM'])).toEqual(['HAM', 'NOR'])
  })
})

describe('escolha lembrada', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }

  it('guarda e devolve por sessão', () => {
    const store = memory()
    saveChoice('2026/20-sao-paulo/Q', { drivers: ['NOR', 'RUS', 'LEC'], n: 50 }, store)
    expect(loadChoice('2026/20-sao-paulo/Q', ['NOR', 'RUS', 'LEC'], store)).toEqual({ drivers: ['NOR', 'RUS', 'LEC'], n: 50 })
    expect(loadChoice('2026/20-sao-paulo/R', ['NOR'], store)).toBeNull()
  })

  it('ignora pilotos sem telemetria e escolhas inválidas', () => {
    const store = memory()
    saveChoice('a', { drivers: ['NOR', 'XXX'], n: 25 }, store)
    expect(loadChoice('a', ['NOR'], store)).toEqual({ drivers: ['NOR'], n: 25 })
    store.setItem('apexview:minisectors:b', '{"drivers":["NOR"],"n":7}')
    expect(loadChoice('b', ['NOR'], store)).toBeNull()
    store.setItem('apexview:minisectors:c', 'não é json')
    expect(loadChoice('c', ['NOR'], store)).toBeNull()
    expect(loadChoice('a', ['NOR'], null)).toBeNull()
  })
})

describe('cores', () => {
  it('companheiro de equipe ganha um tom mais claro', () => {
    const team: Record<string, string> = { RUS: '#00D7B6', ANT: '#00D7B6', NOR: '#F47600' }
    const c = driverColors(['RUS', 'NOR', 'ANT'], (d) => team[d])
    expect(c.RUS).toBe('#00D7B6')
    expect(c.NOR).toBe('#F47600')
    expect(c.ANT).toBe(lighten('#00D7B6', 0.72))
  })

  it('lighten mistura com branco', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080')
    expect(lighten('oops', 0.5)).toBe('oops')
  })
})
