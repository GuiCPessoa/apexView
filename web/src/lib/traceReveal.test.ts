import { describe, expect, it } from 'vitest'
import { MAX_REVEAL_MS, clipTrace, nextReveal, revealDone, revealHead } from './traceReveal'

describe('nextReveal', () => {
  it('aparece direto na primeira vez, em volta nova ou sem intervalo conhecido', () => {
    expect(nextReveal(undefined, true, 500, 1000, 1000)).toEqual({ from: 500, to: 500, t0: 1000, dur: 0 })
    const prev = { from: 400, to: 500, t0: 0, dur: 1000 }
    expect(nextReveal(prev, false, 80, 1000, 1000).dur).toBe(0)
    expect(nextReveal(prev, true, 600, 1000, null).dur).toBe(0)
  })

  it('cresce da ponta atual até o novo fim no intervalo entre envios', () => {
    const prev = { from: 400, to: 500, t0: 0, dur: 1000 }
    // o envio anterior ainda está no meio (ponta em 450): parte dali, não de 500
    const r = nextReveal(prev, true, 570, 500, 1000)
    expect(r).toEqual({ from: 450, to: 570, t0: 500, dur: 1000 })
    expect(revealHead(r, 1000)).toBeCloseTo(510)
    expect(revealDone(r, 1499)).toBe(false)
    expect(revealDone(r, 1500)).toBe(true)
    expect(revealHead(r, 9000)).toBe(570)
  })

  it('limita a duração (replay pausado por muito tempo)', () => {
    const prev = { from: 0, to: 100, t0: 0, dur: 0 }
    expect(nextReveal(prev, true, 200, 60_000, 60_000).dur).toBe(MAX_REVEAL_MS)
  })
})

describe('clipTrace', () => {
  const d = [0, 100, 200, 300]
  const v = [10, 20, 30, 40]

  it('corta na ponta com o último ponto interpolado', () => {
    expect(clipTrace(d, v, 150)).toEqual({ d: [0, 100, 150], values: [10, 20, 25] })
  })

  it('em degrau, o último ponto repete o valor anterior', () => {
    expect(clipTrace(d, [0, 1, 0, 1], 150, true)).toEqual({ d: [0, 100, 150], values: [0, 1, 1] })
  })

  it('ponta exatamente numa amostra ou além do fim', () => {
    expect(clipTrace(d, v, 200)).toEqual({ d: [0, 100, 200], values: [10, 20, 30] })
    const all = clipTrace(d, v, 999)
    expect(all.d).toBe(d)
    expect(all.values).toBe(v)
    expect(clipTrace(d, v, -1)).toEqual({ d: [], values: [] })
  })
})
