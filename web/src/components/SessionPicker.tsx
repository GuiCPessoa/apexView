import { useMemo } from 'react'
import { loadCalendar } from '../lib/data'
import { routeHref, useAsync } from '../lib/route'
import { SESSION_LABEL } from '../lib/session'
import type { DataIndex, SessionIndexEntry } from '../types/data'

const SESSION_ORDER = ['FP1', 'SQ', 'FP2', 'FP3', 'S', 'Q', 'R']

interface Props {
  index: DataIndex
  current: SessionIndexEntry
}

const go = (s: SessionIndexEntry) => (window.location.hash = routeHref({ view: 'session', path: s.path }))

/** Filtro de ano → corrida → sessão, a partir do index.json e do calendário do ano. */
export default function SessionPicker({ index, current }: Props) {
  const years = useMemo(
    () => [...new Set(index.sessions.map((s) => s.year))].sort((a, b) => b - a),
    [index.sessions],
  )
  const hasCalendar = index.seasons.some((s) => s.year === current.year)
  const { data: calendar } = useAsync(hasCalendar ? () => loadCalendar(current.year) : null, [current.year, hasCalendar])

  const ofYear = index.sessions.filter((s) => s.year === current.year)
  const exportedRounds = new Map<number, SessionIndexEntry[]>()
  for (const s of ofYear) exportedRounds.set(s.round, [...(exportedRounds.get(s.round) ?? []), s])

  // rodadas: do calendário (inclui as sem dados) ou, sem calendário, só as exportadas
  const rounds = calendar
    ? calendar.rounds.map((r) => ({ round: r.round, name: r.eventName }))
    : [...exportedRounds.entries()].map(([round, ss]) => ({ round, name: ss[0].eventName }))

  const weekend = (exportedRounds.get(current.round) ?? []).sort(
    (a, b) => SESSION_ORDER.indexOf(a.session) - SESSION_ORDER.indexOf(b.session),
  )

  /** Ao trocar de ano ou rodada, tenta manter o mesmo tipo de sessão; senão a corrida; senão a primeira. */
  const pickIn = (candidates: SessionIndexEntry[]) =>
    candidates.find((s) => s.session === current.session) ??
    candidates.find((s) => s.session === 'R') ??
    candidates[0]

  const onYear = (year: number) => {
    const ss = index.sessions.filter((s) => s.year === year)
    const lastRound = Math.max(...ss.map((s) => s.round))
    const target = pickIn(ss.filter((s) => s.round === lastRound))
    if (target) go(target)
  }

  const onRound = (round: number) => {
    const target = pickIn(exportedRounds.get(round) ?? [])
    if (target) go(target)
  }

  return (
    <div className="session-picker">
      <div className="picker-row">
        <label>
          <span>Ano</span>
          <select value={current.year} onChange={(e) => onYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span>Corrida</span>
          <select value={current.round} onChange={(e) => onRound(Number(e.target.value))}>
            {rounds.map((r) => (
              <option key={r.round} value={r.round} disabled={!exportedRounds.has(r.round)}>
                R{r.round} · {r.name}
                {exportedRounds.has(r.round) ? '' : ' (sem dados)'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="session-pills" role="group" aria-label="Sessão">
        {weekend.map((s) => (
          <button
            key={s.path}
            className={s.path === current.path ? 'active' : undefined}
            aria-pressed={s.path === current.path}
            onClick={() => go(s)}
          >
            {SESSION_LABEL[s.session] ?? s.sessionName}
          </button>
        ))}
      </div>
    </div>
  )
}
