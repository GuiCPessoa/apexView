import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSession, lastSessionPath, parseRoute, rememberSession, routeHref, type KeyValueStore } from './route'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const all = () => true

describe('parseRoute / routeHref', () => {
  it('lê e monta a rota de uma sessão', () => {
    const route = parseRoute('#/sessao/2026/monaco/Q/telemetria')
    expect(route).toEqual({ view: 'session', path: '2026/monaco/Q', tab: 'telemetry' })
    expect(routeHref(route)).toBe('#/sessao/2026/monaco/Q/telemetria')
  })
})

describe('última sessão aberta', () => {
  beforeEach(() => forgetSession())

  it('sem sessão escolhida, a aba Sessões abre a mais recente (null)', () => {
    expect(lastSessionPath(all, memoryStore())).toBeNull()
  })

  it('lembra a sessão escolhida depois de visitar outra tela', () => {
    const store = memoryStore()
    rememberSession(parseRoute('#/sessao/2026/monaco/Q'), store)
    rememberSession(parseRoute('#/calendario/2026'), store)
    rememberSession(parseRoute('#/ao-vivo'), store)
    expect(lastSessionPath(all, store)).toBe('2026/monaco/Q')
  })

  it('a escolha mais nova vence, e a sessão sem caminho não apaga a anterior', () => {
    const store = memoryStore()
    rememberSession(parseRoute('#/sessao/2026/monaco/Q'), store)
    rememberSession(parseRoute('#/sessao/2026/spa/R'), store)
    rememberSession(parseRoute('#/sessao'), store)
    expect(lastSessionPath(all, store)).toBe('2026/spa/R')
  })

  it('recupera do armazenamento da aba depois de recarregar a página', () => {
    const store = memoryStore()
    rememberSession(parseRoute('#/sessao/2025/monza/R'), store)
    forgetSession()
    expect(lastSessionPath(all, store)).toBe('2025/monza/R')
  })

  it('ignora sessão que não existe mais entre as exportadas ou valor estranho guardado', () => {
    const store = memoryStore()
    rememberSession(parseRoute('#/sessao/2025/monza/R'), store)
    expect(lastSessionPath(() => false, store)).toBeNull()
    forgetSession()
    store.data.set('apexview:last-session', 'javascript:alert(1)')
    expect(lastSessionPath(all, store)).toBeNull()
  })

  it('funciona sem armazenamento (bloqueado pelo navegador)', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    rememberSession(parseRoute('#/sessao/2026/monaco/R'), broken)
    expect(lastSessionPath(all, broken)).toBe('2026/monaco/R')
    forgetSession()
    expect(lastSessionPath(all, broken)).toBeNull()
  })
})
