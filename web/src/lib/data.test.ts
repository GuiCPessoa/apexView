import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cached, clearCache, deltaDecode } from './data'

describe('deltaDecode', () => {
  it('desfaz o delta_encode do pipeline, recomeçando depois de lacunas', () => {
    expect(deltaDecode([100, 3, null, 50, 2])).toEqual([100, 103, null, 50, 52])
    expect(deltaDecode([null, 5, -1])).toEqual([null, 5, 4])
    expect(deltaDecode([])).toEqual([])
  })
})

describe('cached', () => {
  beforeEach(clearCache)

  it('pedidos iguais compartilham um único carregamento', async () => {
    const load = vi.fn(async () => ({ ok: true }))
    const [a, b] = await Promise.all([cached('x.json', load), cached('x.json', load)])
    expect(load).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    await cached('y.json', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('falhas não ficam guardadas', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce(42)
    await expect(cached('x.json', load)).rejects.toThrow('HTTP 500')
    await expect(cached('x.json', load)).resolves.toBe(42)
  })

  it('busca de novo depois de 10 minutos', async () => {
    const load = vi.fn(async () => 1)
    await cached('x.json', load, 0)
    await cached('x.json', load, 9 * 60 * 1000)
    expect(load).toHaveBeenCalledTimes(1)
    await cached('x.json', load, 11 * 60 * 1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('descarta os mais antigos quando passa do limite', async () => {
    const load = vi.fn(async () => 1)
    for (let i = 0; i < 101; i++) await cached(`f${i}.json`, load)
    await cached('f100.json', load) // o mais recente continua guardado
    expect(load).toHaveBeenCalledTimes(101)
    await cached('f0.json', load) // o primeiro saiu
    expect(load).toHaveBeenCalledTimes(102)
  })
})
