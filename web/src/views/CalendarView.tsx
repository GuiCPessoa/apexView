import { useState } from 'react'
import { formatSessionStart, loadCalendar } from '../lib/data'
import { routeHref, useAsync } from '../lib/route'
import type { CalendarRound, DataIndex, SessionCode } from '../types/data'

const SESSION_LABELS: Record<string, string> = {
  FP1: 'Treino 1',
  FP2: 'Treino 2',
  FP3: 'Treino 3',
  SQ: 'Quali sprint',
  S: 'Sprint',
  Q: 'Classificação',
  R: 'Corrida',
}

const sessionLabel = (code: SessionCode) => SESSION_LABELS[code] ?? code

/** Fim da corrida estimado em ~2h após a largada. */
function raceEnd(round: CalendarRound): number | null {
  const race = round.sessions.find((s) => s.code === 'R')
  if (!race?.start) return null
  return new Date(race.start.length === 10 ? `${race.start}T23:59:59Z` : race.start).getTime() + 2 * 3600_000
}

export default function CalendarView({ year, index }: { year: number; index: DataIndex }) {
  const hasSeason = index.seasons.some((s) => s.year === year)
  const { data: calendar, error } = useAsync(hasSeason ? () => loadCalendar(year) : null, [year, hasSeason])
  const [now] = useState(() => Date.now())

  if (!hasSeason) return <p className="notice">Temporada {year} não exportada.</p>
  if (error) return <p className="notice error">{error}</p>
  if (!calendar) return <p className="notice">Carregando…</p>

  const next = calendar.rounds.find((r) => (raceEnd(r) ?? Infinity) > now) ?? null
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const doneCount = calendar.rounds.filter((r) => (raceEnd(r) ?? Infinity) <= now).length

  return (
    <section>
      <div className="section-head">
        <h1>Calendário {year}</h1>
        <p>
          {calendar.rounds.length} rodadas · {doneCount} concluídas · {calendar.rounds.filter((r) => r.sprint).length}{' '}
          com sprint · horários em {tz.replace(/_/g, ' ')}
        </p>
      </div>

      {next && (
        <div className="next-round">
          <div className="round-title">
            <span className="badge accent">Próxima · R{next.round}</span>
            {next.sprint && <span className="badge">Sprint</span>}
          </div>
          <h2 className="next-title">{next.eventName}</h2>
          <p className="muted">
            {next.circuitName} · {next.locality}, {next.country}
          </p>
          <ul className="session-times">
            {next.sessions.map((s) => (
              <li key={s.code}>
                <span className="label">{sessionLabel(s.code)}</span>
                <span className="time">{formatSessionStart(s.start)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="calendar">
        {calendar.rounds.map((r) => {
          const done = (raceEnd(r) ?? Infinity) <= now
          const isNext = r.round === next?.round
          const exported = index.sessions.filter((s) => s.year === year && s.round === r.round)
          const first = r.sessions[0]?.start ?? null
          const race = r.sessions.find((s) => s.code === 'R')?.start ?? null
          return (
            <li key={r.round} className={`round ${done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
              <div className="round-num">
                <span>R{r.round}</span>
              </div>
              <div className="round-main">
                <div className="round-title">
                  <h3>{r.eventName}</h3>
                  {r.sprint && <span className="badge">Sprint</span>}
                  {done && <span className="check" title="Concluída" aria-label="Concluída">✓</span>}
                </div>
                <p className="muted">
                  {r.circuitName} · {r.locality}, {r.country}
                </p>
                <p className="dates">
                  {formatSessionStart(first, false)} – {formatSessionStart(race, false)}
                </p>
                {exported.length > 0 && (
                  <p className="links">
                    {exported.map((s) => (
                      <a key={s.path} href={routeHref({ view: 'session', path: s.path })}>
                        Ver {sessionLabel(s.session).toLowerCase()} →
                      </a>
                    ))}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <p className="foot">
        Dados: Jolpica-F1 · gerado em {new Date(calendar.generatedAt).toLocaleString('pt-BR')}
      </p>
    </section>
  )
}
