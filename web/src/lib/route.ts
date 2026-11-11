import { useEffect, useState } from 'react'

/** Rotas no hash da URL (funciona em hospedagem estática sem configuração extra). */
export type Route =
  | { view: 'standings'; year: number | null }
  | { view: 'calendar'; year: number | null }
  | { view: 'session'; path: string | null; tab?: SessionTab }
  | { view: 'live' }

export type SessionTab = 'results' | 'race' | 'laps' | 'replay' | 'telemetry'

const TAB_SLUG: Record<SessionTab, string> = { results: '', race: 'corrida', laps: 'voltas', replay: 'replay', telemetry: 'telemetria' }

export function parseRoute(hash: string): Route {
  const [view, ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const year = rest[0] && /^\d{4}$/.test(rest[0]) ? Number(rest[0]) : null
  switch (view) {
    case 'calendario':
      return { view: 'calendar', year }
    case 'ao-vivo':
      return { view: 'live' }
    case 'sessao':
      return {
        view: 'session',
        path: rest.length >= 3 ? rest.slice(0, 3).join('/') : null,
        tab: (Object.entries(TAB_SLUG).find(([, slug]) => slug && slug === rest[3])?.[0] as SessionTab) ?? 'results',
      }
    default:
      return { view: 'standings', year }
  }
}


export function routeHref(route: Route): string {
  switch (route.view) {
    case 'standings':
      return `#/classificacao${route.year ? `/${route.year}` : ''}`
    case 'calendar':
      return `#/calendario${route.year ? `/${route.year}` : ''}`
    case 'live':
      return '#/ao-vivo'
    case 'session':
      return `#/sessao${route.path ? `/${route.path}` : ''}${route.path && route.tab && route.tab !== 'results' ? `/${TAB_SLUG[route.tab]}` : ''}`
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** Carrega dados assíncronos e ignora respostas de requisições antigas. */
export function useAsync<T>(load: (() => Promise<T>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  // As dependências vêm de quem chama (como no useEffect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!load) return
    let cancelled = false
    setState({ data: null, error: null })
    load()
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((e: Error) => !cancelled && setState({ data: null, error: e.message }))
    return () => {
      cancelled = true
    }
  }, deps)
  return state
}
