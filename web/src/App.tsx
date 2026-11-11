import { loadIndex } from './lib/data'
import { routeHref, useAsync, useRoute, type Route } from './lib/route'
import CalendarView from './views/CalendarView'
import LiveView from './views/LiveView'
import SessionView from './views/SessionView'
import StandingsView from './views/StandingsView'

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

  const seasons = index?.seasons ?? []
  const latestYear = seasons.length ? seasons[seasons.length - 1].year : null
  const year = route.view === 'standings' || route.view === 'calendar' ? (route.year ?? latestYear) : latestYear

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a className="logo" href="#/">
            apex<span>View</span>
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
        {index && route.view === 'standings' && year && <StandingsView year={year} index={index} />}
        {index && route.view === 'calendar' && year && <CalendarView year={year} index={index} />}
        {route.view === 'live' && <LiveView index={index} />}
        {index && route.view === 'session' && <SessionView path={route.path} tab={route.tab ?? 'results'} index={index} />}
        {index && (route.view === 'standings' || route.view === 'calendar') && !year && (
          <p className="notice">
            Nenhuma temporada exportada. Rode <code>python export_standings.py 2026</code> em <code>pipeline/</code>.
          </p>
        )}
      </main>
    </>
  )
}
