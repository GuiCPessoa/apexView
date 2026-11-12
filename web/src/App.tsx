import { lazy, Suspense, useEffect } from 'react'
import logoIcon from './assets/logo-icon.png'
import { loadIndex } from './lib/data'
import { routeHref, useAsync, useRoute, type Route } from './lib/route'

// Cada tela é um pedaço separado do pacote: a primeira visita só baixa e executa a tela aberta.
const views = {
  standings: () => import('./views/StandingsView'),
  calendar: () => import('./views/CalendarView'),
  session: () => import('./views/SessionView'),
  live: () => import('./views/LiveView'),
}
const StandingsView = lazy(views.standings)
const CalendarView = lazy(views.calendar)
const SessionView = lazy(views.session)
const LiveView = lazy(views.live)

/** Com o navegador ocioso, baixa as outras telas para a troca de aba ser imediata. */
function usePreloadViews() {
  useEffect(() => {
    const preload = () => Object.values(views).forEach((load) => void load().catch(() => undefined))
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(preload, { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(preload, 2000)
    return () => clearTimeout(id)
  }, [])
}

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'standings', label: 'Classificação' },
  { view: 'calendar', label: 'Calendário' },
  { view: 'session', label: 'Sessões' },
  { view: 'live', label: 'Ao vivo' },
]

/** Destino de cada aba do topo (classificação e calendário mantêm o ano escolhido). */
function tabRoute(view: Route['view'], route: Route, year: number | null): Route {
  if (view === 'session') return { view: 'session', path: null }
  if (view === 'live') return { view: 'live' }
  return { view, year: route.view === 'standings' || route.view === 'calendar' ? year : null }
}

export default function App() {
  const route = useRoute()
  const { data: index, error } = useAsync(loadIndex, [])
  usePreloadViews()

  const seasons = index?.seasons ?? []
  const latestYear = seasons.length ? seasons[seasons.length - 1].year : null
  const year = route.view === 'standings' || route.view === 'calendar' ? (route.year ?? latestYear) : latestYear

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a className="logo" href="#/">
            <img src={logoIcon} alt="" width={28} height={28} />
            <em>
              apex<span>View</span>
            </em>
          </a>
          <nav className="tabs" aria-label="Seções">
            {TABS.map((t) => (
              <a
                key={t.view}
                href={routeHref(tabRoute(t.view, route, year))}
                className={route.view === t.view ? 'active' : undefined}
                aria-current={route.view === t.view ? 'page' : undefined}
              >
                {t.label}
              </a>
            ))}
          </nav>
          {(route.view === 'standings' || route.view === 'calendar') && seasons.length > 1 && (
            <select
              value={year ?? ''}
              aria-label="Temporada"
              onChange={(e) => (window.location.hash = routeHref({ view: route.view, year: Number(e.target.value) }))}
            >
              {[...seasons].reverse().map((s) => (
                <option key={s.year} value={s.year}>
                  {s.year}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>
      <main>
        {error && <p className="notice error">{error}</p>}
        <Suspense fallback={<p className="notice">Carregando…</p>}>
          {index && route.view === 'standings' && year && <StandingsView year={year} index={index} />}
          {index && route.view === 'calendar' && year && <CalendarView year={year} index={index} />}
          {route.view === 'live' && <LiveView index={index} />}
          {index && route.view === 'session' && <SessionView path={route.path} tab={route.tab ?? 'results'} index={index} />}
        </Suspense>
        {index && (route.view === 'standings' || route.view === 'calendar') && !year && (
          <p className="notice">
            Nenhuma temporada exportada. Rode <code>python export_standings.py 2026</code> em <code>pipeline/</code>.
          </p>
        )}
      </main>
    </>
  )
}
