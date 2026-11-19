import { describe, expect, it } from 'vitest'
import type { LiveSnapshot } from '../types/live'
import { DelayBuffer, accountKind, bufferKey, emptySticky, formatExpiry, formatLiveGap, formatRemaining, loginUrl, sourceKey, tracePath, withSticky } from './live'

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

describe('bufferKey', () => {
  it('muda com o pulo na gravação, mas a sessão continua a mesma', () => {
    const at = (generation?: number) =>
      ({ source: { mode: 'replay', selected: '2026/a/', generation } }) as unknown as LiveSnapshot
    expect(bufferKey(at(1))).not.toBe(bufferKey(at(2)))
    expect(sourceKey(at(1))).toBe(sourceKey(at(2)))
    expect(bufferKey(at(undefined))).toBe(bufferKey(at(0)))
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

describe('conta F1 TV', () => {
  const now = 1_800_000_000

  it('classifica a conta: conectada, vencendo em menos de 24 h ou desconectada', () => {
    expect(accountKind({ connected: true, expires: now + 3 * 86400 }, now)).toBe('ok')
    expect(accountKind({ connected: true, expires: now + 5 * 3600 }, now)).toBe('expiring')
    expect(accountKind({ connected: true, expires: now - 1 }, now)).toBe('off')
    expect(accountKind({ connected: true, expires: null }, now)).toBe('off')
    expect(accountKind({ connected: false, expires: null }, now)).toBe('off')
  })

  it('escreve o tempo até vencer e a data de vencimento', () => {
    expect(formatRemaining(5 * 3600 + 59 * 60)).toBe('5 h')
    expect(formatRemaining(40 * 60 + 30)).toBe('40 min')
    expect(formatRemaining(20)).toBe('1 min')
    expect(formatExpiry(new Date(2026, 10, 20, 21, 14).getTime() / 1000)).toBe('20/11 às 21:14')
    expect(formatExpiry(new Date(2026, 0, 5, 7, 3).getTime() / 1000)).toBe('05/01 às 07:03')
  })

  it('monta o endereço da página de login a partir do backend', () => {
    expect(loginUrl('ws://127.0.0.1:8000/ws')).toBe('http://127.0.0.1:8000/login')
    expect(loginUrl('ws://127.0.0.1:8000/ws', 'https://apexview-peach.vercel.app')).toBe(
      'http://127.0.0.1:8000/login?from=https%3A%2F%2Fapexview-peach.vercel.app',
    )
    expect(loginUrl('wss://exemplo.dev/ws')).toBe('https://exemplo.dev/login')
    expect(loginUrl('não é url')).toBeNull()
    expect(loginUrl('http://127.0.0.1:8000/ws')).toBeNull()
  })
})
