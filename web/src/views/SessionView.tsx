import { useMemo } from 'react'
import { formatLapTime, formatPoints, loadLaps, loadMeta, loadResults } from '../lib/data'
import { routeHref, useAsync, type SessionTab } from '../lib/route'
import ReplayView from './ReplayView'
import TelemetryView from './TelemetryView'
import type { DataIndex, DriverResult, Lap, SessionMeta } from '../types/data'

export default function SessionView({ path, tab, index }: { path: string | null; tab: SessionTab; index: DataIndex }) {
  const sessions = index.sessions
  const current = path ?? sessions[sessions.length - 1]?.path ?? null
  const known = sessions.some((s) => s.path === current)

  const { data, error } = useAsync(
    current && known ? () => Promise.all([loadMeta(current), loadResults(current), loadLaps(current)]) : null,
    [current, known],
  )

  if (sessions.length === 0) {
    return (
      <p className="notice">
        Nenhuma sessão exportada ainda. Rode <code>python export_session.py 2024 Monza R</code> em <code>pipeline/</code>.
      </p>
    )
  }

  return (
    <section>
      <div className="toolbar">
        <select
          value={current ?? ''}
          aria-label="Sessão"
          onChange={(e) => (window.location.hash = routeHref({ view: 'session', path: e.target.value, tab }))}
        >
          {[...sessions].reverse().map((s) => (
            <option key={s.path} value={s.path}>
              {s.year} · R{s.round} {s.eventName} · {s.sessionName}
            </option>
          ))}
        </select>
      </div>
      {!known && <p className="notice">Sessão {current} não exportada.</p>}
      {error && <p className="notice error">{error}</p>}
      {known && !data && !error && <p className="notice">Carregando…</p>}
      {data && current && (
        <>
          <SessionHeader meta={data[0]} laps={data[2]} />
          <nav className="subtabs" aria-label="Visões da sessão">
            <a
              href={routeHref({ view: 'session', path: current, tab: 'results' })}
              className={tab === 'results' ? 'active' : undefined}
            >
              Resultados
            </a>
            {data[0].replay ? (
              <a
                href={routeHref({ view: 'session', path: current, tab: 'replay' })}
                className={tab === 'replay' ? 'active' : undefined}
              >
                Mapa e replay
              </a>
            ) : (
              <span className="disabled" title="Replay disponível só para corridas e sprints">
                Mapa e replay
              </span>
            )}
            {data[0].telemetry?.length ? (
              <a
                href={routeHref({ view: 'session', path: current, tab: 'telemetry' })}
                className={tab === 'telemetry' ? 'active' : undefined}
              >
                Telemetria
              </a>
            ) : (
              <span className="disabled" title="Sessão exportada sem telemetria">
                Telemetria
              </span>
            )}
          </nav>
          {tab === 'replay' && data[0].replay ? (
            <ReplayView key={current} path={current} meta={data[0]} results={data[1]} laps={data[2]} />
          ) : tab === 'telemetry' && data[0].telemetry?.length ? (
            <TelemetryView key={current} path={current} meta={data[0]} results={data[1]} laps={data[2]} />
          ) : (
            <ResultsTable meta={data[0]} results={data[1]} laps={data[2]} />
          )}
        </>
      )}
    </section>
  )
}

function SessionHeader({ meta, laps }: { meta: SessionMeta; laps: Lap[] }) {
  const lapCount = Math.max(0, ...laps.map((l) => l.lap ?? 0))
  return (
    <div className="section-head">
      <h1>{meta.eventName}</h1>
      <p>
        {meta.sessionName} · {meta.location}, {meta.country}
        {meta.sessionDate && ` · ${new Date(meta.sessionDate).toLocaleDateString('pt-BR')}`}
        {lapCount > 0 && ` · ${lapCount} voltas`}
      </p>
    </div>
  )
}

function ResultsTable({ meta, results, laps }: { meta: SessionMeta; results: DriverResult[]; laps: Lap[] }) {
  const bestLaps = useMemo(() => {
    const best = new Map<string, number>()
    for (const l of laps) {
      if (l.lapTime == null) continue
      const cur = best.get(l.driver)
      if (cur == null || l.lapTime < cur) best.set(l.driver, l.lapTime)
    }
    return best
  }, [laps])

  const fastest = Math.min(...bestLaps.values())
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const isRace = meta.session === 'R' || meta.session === 'S'

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Pos</th>
              <th>Piloto</th>
              <th className="hide-sm">Equipe</th>
              {isRace && <th className="num hide-sm">Grid</th>}
              {isRace && <th className="num">+/−</th>}
              <th className="num">Melhor volta</th>
              <th className="hide-sm">Status</th>
              {isRace && <th className="num">Pts</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const best = bestLaps.get(r.driver) ?? null
              const gained = r.position != null && r.gridPosition ? r.gridPosition - r.position : null
              return (
                <tr key={r.driver}>
                  <td className="num pos">{r.classifiedPosition ?? r.position ?? '—'}</td>
                  <td>
                    <span className="driver">
                      <span className="team-bar" style={{ background: r.teamColor ?? 'var(--muted)' }} />
                      <strong>{r.driver}</strong>
                      <span className="full-name">{r.fullName}</span>
                    </span>
                  </td>
                  <td className="hide-sm">{r.team}</td>
                  {isRace && <td className="num hide-sm">{r.gridPosition === 0 ? 'Pit' : (r.gridPosition ?? '—')}</td>}
                  {isRace && (
                    <td className={`num delta ${gained == null ? '' : gained > 0 ? 'up' : gained < 0 ? 'down' : ''}`}>
                      {gained == null ? '—' : gained > 0 ? `+${gained}` : gained}
                    </td>
                  )}
                  <td className={`num mono ${best === fastest ? 'fastest' : ''}`}>{formatLapTime(best)}</td>
                  <td className="hide-sm muted">{r.status}</td>
                  {isRace && <td className="num">{formatPoints(r.points ?? 0)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="foot">
        Dados: FastF1 {meta.fastf1Version} · gerado em {new Date(meta.generatedAt).toLocaleString('pt-BR')}
      </p>
    </>
  )
}
