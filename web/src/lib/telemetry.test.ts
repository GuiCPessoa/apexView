import { describe, expect, it } from 'vitest'
import type { Lap, LapTelemetry } from '../types/data'
import { compareLaps, fastestLap, interpLinear, interpStep, similarColors, textOn } from './telemetry'

describe('interpolação', () => {
  it('linear entre amostras e valor da ponta fora do intervalo', () => {
    expect(interpLinear([10, 20], [100, 200], [0, 10, 15, 20, 30])).toEqual([100, 100, 150, 200, 200])
  })

  it('degrau mantém o valor da última amostra', () => {
    expect(interpStep([0, 10, 20], [1, 2, 3], [0, 9, 10, 25])).toEqual([1, 1, 2, 3])
  })
})

describe('compareLaps', () => {
  const base = { lapTime: null, compound: null, throttle: [100, 100], brake: [0, 0], gear: [8, 8], drs: [0, 0] }
  const a: LapTelemetry = { ...base, lap: 1, d: [0, 100], t: [0, 1], speed: [360, 360] }
  const b: LapTelemetry = { ...base, lap: 2, d: [0, 100], t: [0, 1.5], speed: [240, 240] }

  it('alinha por distância e calcula o delta B − A', () => {
    const c = compareLaps(a, b, 50)
    expect(c.d).toEqual([0, 50, 100])
    expect(c.delta).toEqual([0, 0.25, 0.5])
  })

  it('a amostra atrasada da largada não cria diferença falsa', () => {
    // mesmo ritmo (50 m/s), mas a primeira amostra de B vem 16 m (0,32 s) depois da linha
    const lap = (first: number): LapTelemetry => {
      const d: number[] = []
      const t: number[] = []
      for (let x = first; x < 1000; x += 12.5) {
        d.push(x)
        t.push(x / 50)
      }
      const z = d.map(() => 0)
      return { lap: 1, lapTime: 20, compound: null, d, t, speed: d.map(() => 180), throttle: z, brake: z, gear: z, drs: z }
    }
    const c = compareLaps(lap(0.5), lap(16), 5)
    expect(Math.max(...c.delta!.map(Math.abs))).toBeLessThan(0.005)
  })

  it('termina com a diferença dos tempos de volta, mesmo com distâncias diferentes', () => {
    const lap = (length: number, lapTime: number): LapTelemetry => {
      const d: number[] = []
      const t: number[] = []
      for (let i = 1; i < 80; i++) {
        d.push((length * i) / 80)
        t.push((lapTime * i) / 80)
      }
      const z = d.map(() => 0)
      const v = (length / lapTime) * 3.6
      return { lap: 1, lapTime, compound: null, d, t, speed: d.map(() => v), throttle: z, brake: z, gear: z, drs: z }
    }
    // B integrou 12 m a mais, mas é a mesma pista
    const c = compareLaps(lap(4000, 80), lap(4012, 80.4), 5)
    expect(c.d[c.d.length - 1]).toBeGreaterThan(3990)
    expect(c.delta![0]).toBeCloseTo(0, 6)
    expect(c.delta![c.delta!.length - 1]).toBeCloseTo(0.4, 2)
  })

  it('sem B, só a volta de A na grade inteira', () => {
    const c = compareLaps(a, null, 50)
    expect(c.d).toEqual([0, 50, 100])
    expect(c.a.speed).toEqual([360, 360, 360])
    expect(c.b).toBeNull()
    expect(c.delta).toBeNull()
  })
})

describe('cores', () => {
  it('detecta cores parecidas', () => {
    expect(similarColors('#ff8000', '#ff8700')).toBe(true)
    expect(similarColors('#ff8000', '#3671c6')).toBe(false)
  })

  it('escolhe texto escuro em fundo claro', () => {
    expect(textOn('#f0f0ec')).toBe('#111')
    expect(textOn('#e10600')).toBe('#fff')
  })
})

describe('fastestLap', () => {
  it('ignora voltas anuladas', () => {
    const l = (driver: string, lap: number, lapTime: number, deleted: boolean | null) =>
      ({ driver, lap, lapTime, deleted }) as Lap
    const laps = [l('AAA', 1, 80, true), l('AAA', 2, 81, false), l('BBB', 1, 80.5, null)]
    expect(fastestLap(laps)?.driver).toBe('BBB')
    expect(fastestLap(laps, 'AAA')?.lap).toBe(2)
  })
})
