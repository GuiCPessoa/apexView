import { describe, expect, it } from 'vitest'
import { CarMotion, MAX_GLIDE_MS, fitViewBox, pickCar } from './carMotion'

describe('CarMotion', () => {
  it('carro novo aparece direto no lugar', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 10, y: 20 }], 0, 100)
    expect(m.position('VER', 0)).toEqual([10, 20])
    expect(m.moving(0)).toBe(false)
    expect(m.position('HAM', 0)).toBeNull()
  })

  it('desliza até a posição nova no intervalo entre snapshots', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 0, y: 0 }], 0, 100)
    m.update([{ id: 'VER', x: 40, y: 0 }], 250, 100)
    expect(m.position('VER', 250)).toEqual([0, 0])
    expect(m.position('VER', 375)).toEqual([20, 0])
    expect(m.position('VER', 500)).toEqual([40, 0])
    expect(m.moving(400)).toBe(true)
    expect(m.moving(500)).toBe(false)
  })

  it('snapshot no meio do deslize parte de onde o carro está', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 0, y: 0 }], 0, 100)
    m.update([{ id: 'VER', x: 40, y: 0 }], 250, 100)
    m.update([{ id: 'VER', x: 60, y: 0 }], 375, 100) // chegou cedo: carro estava em 20
    expect(m.position('VER', 375)).toEqual([20, 0])
    expect(m.position('VER', 375 + 125)).toEqual([60, 0])
  })

  it('salto grande (pulo na gravação) e movimento reduzido vão direto', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 0, y: 0 }], 0, 100)
    m.update([{ id: 'VER', x: 500, y: 0 }], 250, 100)
    expect(m.position('VER', 250)).toEqual([500, 0])
    m.update([{ id: 'VER', x: 510, y: 0 }], 500, 100, true)
    expect(m.position('VER', 500)).toEqual([510, 0])
  })

  it('intervalo longo não vira deslize lento demais', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 0, y: 0 }], 0, 100)
    m.update([{ id: 'VER', x: 10, y: 0 }], 5000, 100)
    expect(m.position('VER', 5000 + MAX_GLIDE_MS)).toEqual([10, 0])
  })

  it('carro que saiu do snapshot some do mapa', () => {
    const m = new CarMotion()
    m.update([{ id: 'VER', x: 0, y: 0 }], 0, 100)
    m.update([], 250, 100)
    expect(m.position('VER', 250)).toBeNull()
  })
})

describe('fitViewBox', () => {
  it('encaixa como o SVG (meet), centralizando', () => {
    // viewBox 100×50 numa caixa 400×400: escala 4, sobra vertical de 200 dividida em cima e embaixo
    const f = fitViewBox({ x: -10, y: 0, w: 100, h: 50 }, 400, 400)
    expect(f.scale).toBe(4)
    expect(f.ox).toBe(40) // x = -10 cai na borda esquerda
    expect(f.oy).toBe(100)
  })
})

describe('pickCar', () => {
  const cars = [
    { id: 'A', r: 2 },
    { id: 'B', r: 2 },
  ]
  const at = (id: string): [number, number] => (id === 'A' ? [0, 0] : [1, 0])

  it('acha o carro sob o ponteiro, preferindo o de cima', () => {
    expect(pickCar(cars, at, 0.5, 0, 1)?.id).toBe('B')
    expect(pickCar(cars, at, -3, 0, 1)?.id).toBe('A')
    expect(pickCar(cars, at, 50, 50, 1)).toBeNull()
  })

  it('respeita o alvo mínimo', () => {
    expect(pickCar(cars, at, 0, 8, 10)?.id).toBe('B')
  })
})
