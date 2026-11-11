import { describe, expect, it } from 'vitest'
import type { LiveSnapshot } from '../types/live'
import { DelayBuffer, formatLiveGap, sourceKey, tracePath, withOutline } from './live'

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

describe('withOutline', () => {
  it('mantém o último traçado quando o snapshot não traz', () => {
    const snap = { type: 'snapshot' } as LiveSnapshot
    const outline: [number, number][] = [[0, 0]]
    expect(withOutline(snap, outline).outline).toBe(outline)
    expect(withOutline({ ...snap, outline: null }, outline).outline).toBeNull()
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
