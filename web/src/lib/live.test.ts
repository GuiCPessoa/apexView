import { describe, expect, it } from 'vitest'
import type { LiveSnapshot } from '../types/live'
import { DelayBuffer, emptySticky, formatLiveGap, sourceKey, tracePath, withSticky } from './live'

describe('DelayBuffer', () => {
  it('devolve o valor de alguns segundos atrás', () => {
    const b = new DelayBuffer<number>()
    for (let s = 0; s <= 10; s++) b.push(s, s * 1000)
    expect(b.at(10_000, 0)).toBe(10)
    expect(b.at(10_000, 3000)).toBe(7)
    expect(b.at(10_500, 3000)).toBe(7)
  })

  it('sem histórico suficiente, mostra o mais antigo', () => {
    const b = new DelayBuffer<number>()
    b.push(1, 5000)
    expect(b.at(5000, 30_000)).toBe(1)
    expect(new DelayBuffer<number>().at(0, 0)).toBeNull()
  })

  it('descarta o que passou do limite guardado', () => {
    const b = new DelayBuffer<number>(2000)
    for (let s = 0; s <= 10; s++) b.push(s, s * 1000)
    expect(b.at(10_000, 60_000)).toBe(8)
  })
})

describe('formatLiveGap', () => {
  it('traduz os textos do feed', () => {
    expect(formatLiveGap('+1.234')).toBe('+1.234')
    expect(formatLiveGap('LAP 34')).toBe('Volta 34')
    expect(formatLiveGap('1 L')).toBe('+1 V')
    expect(formatLiveGap('2 LAPS')).toBe('+2 V')
    expect(formatLiveGap(null)).toBe('')
  })
})

describe('withSticky', () => {
  it('mantém o último valor dos campos que só vêm quando mudam', () => {
    const last = emptySticky()
    const outline: [number, number][] = [[0, 0]]
    const rc = [{ time: 1, lap: 1, category: 'Flag', flag: 'GREEN', scope: 'Track', sector: null, driver: null, status: null, message: 'GREEN LIGHT' }]
    const first = withSticky({ type: 'snapshot', outline, raceControl: rc } as LiveSnapshot, last)
    expect(first.outline).toBe(outline)
    expect(first.weatherHistory).toEqual([])
    const next = withSticky({ type: 'snapshot' } as LiveSnapshot, last)
    expect(next.outline).toBe(outline)
    expect(next.raceControl).toBe(rc)
    expect(withSticky({ type: 'snapshot', outline: null } as LiveSnapshot, last).outline).toBeNull()
  })
})

describe('tracePath', () => {
  it('escala distância e valor para o retângulo do gráfico', () => {
    expect(tracePath([0, 500, 1000], [0, 50, 100], 1000, 0, 100, 200, 100)).toBe('M0.0,100.0L100.0,50.0L200.0,0.0')
  })

  it('degrau para canais liga/desliga e limita fora da escala', () => {
    expect(tracePath([0, 1000, 3000], [0, 1, 2], 2000, 0, 1, 100, 10, true)).toBe('M0.0,10.0H50.0V0.0H100.0V0.0')
  })
})

describe('sourceKey', () => {
  it('muda quando troca a sessão ou o modo', () => {
    const snap = (mode: string, selected: string | null) => ({ source: { mode, selected } }) as unknown as LiveSnapshot
    expect(sourceKey(snap('replay', '2026/a/'))).toBe(sourceKey(snap('replay', '2026/a/')))
    expect(sourceKey(snap('replay', '2026/a/'))).not.toBe(sourceKey(snap('replay', '2026/b/')))
    expect(sourceKey(snap('live', null))).not.toBe(sourceKey(snap('idle', null)))
  })
})
