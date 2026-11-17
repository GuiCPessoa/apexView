import { describe, expect, it } from 'vitest'
import { PRESENCE_ID, browserId, countOnline, randomId } from './presence'

function memoryStore() {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('presença', () => {
  it('gera identificadores aleatórios no formato aceito pelas regras do banco', () => {
    const id = randomId()
    expect(id).toMatch(PRESENCE_ID)
    expect(randomId()).not.toBe(id)
    expect(randomId(() => new Uint8Array(20).fill(255))).toBe('-'.repeat(20))
  })

  it('reaproveita o identificador do navegador entre abas', () => {
    const store = memoryStore()
    const first = browserId(store)
    expect(browserId(store)).toBe(first)
    store.data.set('apexview:presence-id', 'valor estranho!')
    expect(browserId(store, () => 'B'.repeat(20))).toBe('B'.repeat(20))
  })

  it('funciona sem armazenamento', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => undefined,
    }
    expect(browserId(broken, () => 'C'.repeat(20))).toBe('C'.repeat(20))
    expect(browserId(null, () => 'D'.repeat(20))).toBe('D'.repeat(20))
  })

  it('conta navegadores com alguma aba aberta', () => {
    expect(countOnline(null)).toBe(0)
    expect(countOnline({})).toBe(0)
    expect(countOnline({ a: { t1: true, t2: true }, b: { t3: true } })).toBe(2)
    expect(countOnline({ a: { t1: true }, b: {}, c: true, d: null })).toBe(1)
  })
})
