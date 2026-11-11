import { useEffect, useMemo, useState } from 'react'
import { formatLapTime, loadIndex, loadLaps, loadMeta, loadResults } from './lib/data'
import type { DriverResult, Lap, SessionIndexEntry, SessionMeta } from './types/data'

interface SessionData {
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
}

export default function App() {
  const [index, setIndex] = useState<SessionIndexEntry[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<SessionData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadIndex()
      .then((entries) => {
        setIndex(entries)
        if (entries.length > 0) setSelected(entries[entries.length - 1].path)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setData(null)
    Promise.all([loadMeta(selected), loadResults(selected), loadLaps(selected)])
      .then(([meta, results, laps]) => !cancelled && setData({ meta, results, laps }))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [selected])

  return (
    <main>
      <header className="top">
        <h1>
          apex<span>View</span>
        </h1>
        {index && index.length > 0 && (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Sessão">
            {index.map((s) => (
              <option key={s.path} value={s.path}>
                {s.year} · {s.eventName} · {s.sessionName}
              </option>
            ))}
          </select>
        )}
      </header>

      {error && <p className="notice error">{error}</p>}
      {index && index.length === 0 && (
        <p className="notice">
          Nenhuma sessão exportada ainda. Rode <code>python export_session.py 2024 Monza R</code> em <code>pipeline/</code>.
        </p>
      )}
      {!error && selected && !data && <p className="notice">Carregando…</p>}
      {data && <ResultsTable {...data} />}
    </main>
  )
}

function ResultsTable({ meta, results, laps }: SessionData) {
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
  const lapCount = Math.max(0, ...laps.map((l) => l.lap ?? 0))
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const isRace = meta.session === 'R' || meta.session === 'S'

  return (
    <section>
      <div className="session-head">
        <h2>{meta.eventName}</h2>
        <p>
          {meta.sessionName} · {meta.location}, {meta.country}
          {meta.sessionDate && ` · ${new Date(meta.sessionDate).toLocaleDateString('pt-BR')}`}
          {lapCount > 0 && ` · ${lapCount} voltas`}
        </p>
      </div>

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
              const gained =
                r.position != null && r.gridPosition ? r.gridPosition - r.position : null
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
                  {isRace && <td className="num hide-sm">{r.gridPosition === 0 ? 'Pit' : r.gridPosition ?? '—'}</td>}
                  {isRace && (
                    <td className={`num delta ${gained == null ? '' : gained > 0 ? 'up' : gained < 0 ? 'down' : ''}`}>
                      {gained == null ? '—' : gained > 0 ? `+${gained}` : gained}
                    </td>
                  )}
                  <td className={`num mono ${best === fastest ? 'fastest' : ''}`}>{formatLapTime(best)}</td>
                  <td className="hide-sm status">{r.status}</td>
                  {isRace && <td className="num">{r.points ?? 0}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="foot">
        Dados: FastF1 {meta.fastf1Version} · gerado em {new Date(meta.generatedAt).toLocaleString('pt-BR')}
      </p>
    </section>
  )
}
