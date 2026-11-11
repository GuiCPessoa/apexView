import { loadIndex } from './lib/data'
import { routeHref, useAsync, useRoute, type Route } from './lib/route'
import CalendarView from './views/CalendarView'
import SessionView from './views/SessionView'
import StandingsView from './views/StandingsView'

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'standings', label: 'Classificação' },
  { view: 'calendar', label: 'Calendário' },
  { view: 'session', label: 'Sessões' },
]

export default function App() {
  const route = useRoute()
  const { data: index, error } = useAsync(loadIndex, [])

  const seasons = index?.seasons ?? []
  const latestYear = seasons.length ? seasons[seasons.length - 1].year : null
  const year = route.view !== 'session' ? (route.year ?? latestYear) : latestYear

  return (
    <main>
      <header className="top">
        <a className="logo" href="#/">
          apex<span>View</span>
        </a>
        <nav className="tabs" aria-label="Seções">
          {TABS.map((t) => (
            <a
              key={t.view}
              href={routeHref(t.view === 'session' ? { view: 'session', path: null } : { view: t.view, year: route.view === 'session' ? null : year })}
              className={route.view === t.view ? 'active' : undefined}
              aria-current={route.view === t.view ? 'page' : undefined}
            >
              {t.label}
            </a>
          ))}
        </nav>
        {route.view !== 'session' && seasons.length > 1 && (
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
      </header>

      {error && <p className="notice error">{error}</p>}
      {index && route.view === 'standings' && year && <StandingsView year={year} index={index} />}
      {index && route.view === 'calendar' && year && <CalendarView year={year} index={index} />}
      {index && route.view === 'session' && <SessionView path={route.path} tab={route.tab ?? 'results'} index={index} />}
      {index && route.view !== 'session' && !year && (
        <p className="notice">
          Nenhuma temporada exportada. Rode <code>python export_standings.py 2026</code> em <code>pipeline/</code>.
        </p>
      )}
    </main>
  )
}
