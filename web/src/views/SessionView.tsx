import { useMemo } from 'react'
import { formatLapTime, formatPoints, loadLaps, loadMeta, loadResults } from '../lib/data'
import SessionPicker from '../components/SessionPicker'
import { routeHref, useAsync, type SessionTab } from '../lib/route'
import LapsView from './LapsView'
import RaceView from './RaceView'
import { PracticeResults, QualifyingResults } from './SessionResults'
import ReplayView from './ReplayView'
import TelemetryView from './TelemetryView'
import type { DataIndex, DriverResult, Lap, SessionIndexEntry, SessionMeta } from '../types/data'

export default function SessionView({ path, tab, index }: { path: string | null; tab: SessionTab; index: DataIndex }) {
  const sessions = index.sessions
  const current = path ?? defaultSession(sessions)?.path ?? null
  const entry = sessions.find((s) => s.path === current) ?? null
  const known = entry != null

  const { data, error } = useAsync(
    current && known ? () => Promise.all([loadMeta(current), loadResults(current), loadLaps(current)]) : null,
    [current, known],
  )

  const [meta, results, laps] = data ?? [null, null, null]
  const isRace = meta?.session === 'R' || meta?.session === 'S'
  const isQuali = meta?.session === 'Q' || meta?.session === 'SQ'

  if (sessions.length === 0) {
    return (
      <p className="notice">
        Nenhuma sessão exportada ainda. Rode <code>python export_session.py 2024 Monza R</code> em <code>pipeline/</code>.
      </p>
    )
  }

  return (
    <section>
      {entry && <SessionPicker index={index} current={entry} tab={tab} />}
      {!known && <p className="notice">Sessão {current} não exportada.</p>}
      {error && <p className="notice error">{error}</p>}
      {known && !data && !error && <p className="notice">Carregando…</p>}
      {meta && results && laps && current && (
        <>
          <SessionHeader meta={meta} laps={laps} />
          <nav className="subtabs" aria-label="Visões da sessão">
            <a
              href={routeHref({ view: 'session', path: current, tab: 'results' })}
              className={tab === 'results' ? 'active' : undefined}
            >
              Resultados
            </a>
            {isRace ? (
              <a
                href={routeHref({ view: 'session', path: current, tab: 'race' })}
                className={tab === 'race' ? 'active' : undefined}
              >
                {meta.session === 'S' ? 'Sprint' : 'Corrida'}
              </a>
            ) : (
              <a
                href={routeHref({ view: 'session', path: current, tab: 'laps' })}
                className={tab === 'laps' ? 'active' : undefined}
              >
                Voltas e setores
              </a>
            )}
            {meta.replay && (
              <a
                href={routeHref({ view: 'session', path: current, tab: 'replay' })}
                className={tab === 'replay' ? 'active' : undefined}
              >
                Mapa e replay
              </a>
            )}
            {meta.telemetry?.length ? (
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
          {tab === 'race' && isRace ? (
            <RaceView results={results} laps={laps} />
          ) : tab === 'laps' && !isRace ? (
            <LapsView meta={meta} results={results} laps={laps} />
          ) : tab === 'replay' && meta.replay ? (
            <ReplayView key={current} path={current} meta={meta} results={results} laps={laps} />
          ) : tab === 'telemetry' && meta.telemetry?.length ? (
            <TelemetryView key={current} path={current} meta={meta} results={results} laps={laps} />
          ) : isQuali ? (
            <QualifyingResults meta={meta} results={results} />
          ) : isRace ? (
            <ResultsTable meta={meta} results={results} laps={laps} />
          ) : (
            <PracticeResults results={results} laps={laps} />
          )}
        </>
      )}
    </section>
  )
}

/** Sessão padrão: a corrida da rodada mais recente exportada (ou qualquer sessão dela). */
function defaultSession(sessions: SessionIndexEntry[]): SessionIndexEntry | undefined {
  if (sessions.length === 0) return undefined
  const latest = sessions.reduce((a, b) => (b.year > a.year || (b.year === a.year && b.round > a.round) ? b : a))
  const sameRound = sessions.filter((s) => s.year === latest.year && s.round === latest.round)
  return sameRound.find((s) => s.session === 'R') ?? sameRound[0]
}

function SessionHeader({ meta, laps }: { meta: SessionMeta; laps: Lap[] }) {
  const isRace = meta.session === 'R' || meta.session === 'S'
  const lapCount = isRace ? Math.max(0, ...laps.map((l) => l.lap ?? 0)) : laps.filter((l) => l.lapTime != null).length
  return (
    <div className="section-head">
      <h1>{meta.eventName}</h1>
      <p>
        {meta.sessionName} · {meta.location}, {meta.country}
        {meta.sessionDate && ` · ${new Date(meta.sessionDate).toLocaleDateString('pt-BR')}`}
        {lapCount > 0 && ` · ${lapCount} voltas${isRace ? '' : ' cronometradas'}`}
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
