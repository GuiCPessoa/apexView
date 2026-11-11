import { useEffect, useState } from 'react'
import Card from '../components/Card'
import {
  countdown,
  isDone,
  nextSession,
  raceDate,
  sessionDate,
  sessionsByDay,
  timelineScale,
  weekendRange,
} from '../lib/calendar'
import { loadCalendar, loadOutlines, loadStandings } from '../lib/data'
import { routeHref, useAsync } from '../lib/route'
import type { Calendar, CalendarRound, DataIndex, Outlines, RoundResult, SessionCode } from '../types/data'

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
const shortName = (name: string) => name.replace(/ Grand Prix$/, '')
const dateTime = (d: Date) => d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const time = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

type Filter = 'all' | 'done' | 'future'

/** Hora atual, atualizada a cada 30 s (contagem regressiva e rodada seguinte). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

export default function CalendarView({ year, index }: { year: number; index: DataIndex }) {
  const hasSeason = index.seasons.some((s) => s.year === year)
  const { data, error } = useAsync(
    hasSeason
      ? () => Promise.all([loadCalendar(year), loadStandings(year).catch(() => null), loadOutlines(year)])
      : null,
    [year, hasSeason],
  )
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')

  if (!hasSeason) return <p className="notice">Temporada {year} não exportada.</p>
  if (error) return <p className="notice error">{error}</p>
  if (!data) return <p className="notice">Carregando…</p>

  const [calendar, standings, outlines] = data
  const rounds = calendar.rounds
  const results = new Map((standings?.rounds ?? []).map((r) => [r.round, r]))
  const doneCount = rounds.filter((r) => isDone(r, now)).length
  const next = nextSession(rounds, now)
  const nextRound = rounds.find((r) => !isDone(r, now)) ?? null
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')
  const left = rounds.length - doneCount
  const shown = rounds.filter((r) => filter === 'all' || (filter === 'done') === isDone(r, now))

  return (
    <section className="calendar-page">
      <div className="hero">
        <div className="hero-title">
          <span className="kicker">
            <span className="muted">Temporada {year} · </span>
            {rounds.length} rodadas · {rounds.filter((r) => r.sprint).length} com sprint
          </span>
          <h1>{left === 0 ? 'Temporada encerrada' : left === 1 ? 'Falta 1 corrida' : `Faltam ${left} corridas`}</h1>
          <p>Horários no seu fuso ({tz}).</p>
        </div>
        <div className="hero-stats">
          <div className="stat">
            <span className="stat-label">Temporada</span>
            <span className="stat-value">
              {doneCount}/{rounds.length}
            </span>
            <span className="season-progress" aria-hidden="true">
              <span style={{ width: `${(doneCount / Math.max(1, rounds.length)) * 100}%` }} />
            </span>
            <span className="stat-sub">corridas disputadas</span>
          </div>
          {next && (
            <div className="stat">
              <span className="stat-label">Próxima sessão</span>
              <span className="stat-value">{sessionLabel(next.session.code)}</span>
              <span className="stat-sub">
                {next.round.locality} · {dateTime(sessionDate(next.session.start)!)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="dash">
        <Timeline rounds={rounds} results={results} now={now} nextRound={nextRound} />
        {nextRound && <NextRoundCard round={nextRound} next={next} now={now} tz={tz} />}
        <Card
          title="Rodadas"
          span={12}
          aside={
            <div className="seg" role="group" aria-label="Filtrar rodadas">
              {(
                [
                  ['all', 'Todas'],
                  ['done', 'Disputadas'],
                  ['future', 'A disputar'],
                ] as const
              ).map(([value, label]) => (
                <button key={value} className={filter === value ? 'active' : undefined} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <ol className="round-grid">
            {shown.map((r) => (
              <RoundCard
                key={r.round}
                r={r}
                done={isDone(r, now)}
                isNext={r === nextRound}
                result={results.get(r.round) ?? null}
                outlines={outlines}
                sessions={index.sessions.filter((s) => s.year === year && s.round === r.round)}
              />
            ))}
          </ol>
          {shown.length === 0 && <p className="muted">Nenhuma rodada neste filtro.</p>}
        </Card>
      </div>

      <p className="foot">Dados: Jolpica-F1 · gerado em {new Date(calendar.generatedAt).toLocaleString('pt-BR')}</p>
    </section>
  )
}

// ---------- Linha do tempo ----------

function Timeline({
  rounds,
  results,
  now,
  nextRound,
}: {
  rounds: Calendar['rounds']
  results: Map<number, RoundResult>
  now: Date
  nextRound: CalendarRound | null
}) {
  const scale = timelineScale(rounds)
  if (!scale) return null
  const today = scale.pct(now.getTime())
  return (
    <Card title="Linha do tempo" span={12} aside="cor = equipe do vencedor">
      <div className="timeline-strip" role="list" aria-label="Corridas da temporada">
        <span className="ts-line" />
        <span className="ts-done" style={{ width: `${today}%` }} />
        {scale.months.map((m) => (
          <span key={m.start} aria-hidden="true">
            <span className="ts-tick" style={{ left: `${scale.pct(m.start)}%` }} />
            <span className="ts-month" style={{ left: `${scale.pct(m.mid)}%` }}>
              {m.label}
            </span>
          </span>
        ))}
        {today > 0 && today < 100 && (
          <span className="ts-today" style={{ left: `${today}%` }}>
            <span>hoje</span>
          </span>
        )}
        {rounds.map((r, i) => {
          const race = raceDate(r)
          if (!race) return null
          const x = scale.pct(race.getTime())
          const winner = isDone(r, now) ? (results.get(r.round)?.podium[0] ?? null) : null
          const color = winner?.teamColor ?? undefined
          const state = winner ? 'done' : r === nextRound ? 'next' : isDone(r, now) ? 'done' : 'future'
          return (
            <span key={r.round} role="listitem" title={`R${r.round} ${r.eventName}${winner ? ` · ${winner.driver}` : ''}`}>
              <span className={`ts-dot ${state}`} style={{ left: `${x}%`, background: state === 'done' ? color : undefined }} />
              <span className="ts-label" style={{ left: `${x}%`, top: i % 2 ? 26 : 12, color }}>
                {winner ? winner.driver : `R${r.round}`}
              </span>
            </span>
          )
        })}
      </div>
    </Card>
  )
}

// ---------- Próxima rodada ----------

function NextRoundCard({
  round,
  next,
  now,
  tz,
}: {
  round: CalendarRound
  next: ReturnType<typeof nextSession>
  now: Date
  tz: string
}) {
  const target = next?.round === round ? next.session : null
  const left = target ? countdown(sessionDate(target.start)!, now) : null
  return (
    <section className="card span-12 next-round-card">
      <div>
        <span className="badge accent">Próxima · R{round.round}</span> {round.sprint && <span className="badge sprint">Sprint</span>}
        <h2 className="next-round-name">{round.eventName}</h2>
        <p className="muted">
          {round.circuitName} · {round.locality}, {round.country}
        </p>
        {target && left && (
          <>
            <p className="muted countdown-label">{sessionLabel(target.code)} começa em</p>
            <div className="countdown">
              <div>
                <b>{left.days}</b>
                <small>dias</small>
              </div>
              <div>
                <b>{left.hours}</b>
                <small>horas</small>
              </div>
              <div>
                <b>{left.minutes}</b>
                <small>min</small>
              </div>
            </div>
          </>
        )}
      </div>
      <div>
        <header className="card-head">
          <h2>Programação</h2>
          <div className="card-aside">horários em {tz}</div>
        </header>
        <div className="weekend-days">
          {sessionsByDay(round.sessions).map((d) => (
            <div key={d.day} className="weekend-day">
              <h3>{d.day}</h3>
              {d.sessions.map((s) => {
                const start = sessionDate(s.start)
                return (
                  <div key={s.code} className={`weekend-session ${s.code === 'R' ? 'race' : ''} ${s === target ? 'upcoming' : ''}`}>
                    <span>{sessionLabel(s.code)}</span>
                    <time dateTime={s.start ?? undefined}>{start ? time(start) : 'A definir'}</time>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- Rodadas ----------

function RoundCard({
  r,
  done,
  isNext,
  result,
  outlines,
  sessions,
}: {
  r: CalendarRound
  done: boolean
  isNext: boolean
  result: RoundResult | null
  outlines: Outlines | null
  sessions: DataIndex['sessions']
}) {
  const outline = outlines?.outlines[String(r.round)]
  const size = outlines?.size ?? 1000
  const race = raceDate(r)
  const links = (['R', 'S', 'Q'] as const)
    .map((code) => sessions.find((s) => s.session === code))
    .filter((s): s is DataIndex['sessions'][number] => s != null)
  return (
    <li className={`round-card ${done ? 'done' : 'future'} ${isNext ? 'next' : ''}`}>
      <div className="rc-head">
        <span className="rc-num">R{r.round}</span>
        <span>{weekendRange(r)}</span>
        {r.sprint && <span className="badge sprint">Sprint</span>}
        {isNext && <span className="badge accent">Próxima</span>}
      </div>
      {outline ? (
        <svg className="rc-track" viewBox={`${-size * 0.04} ${-size * 0.04} ${size * 1.08} ${size * 1.08}`} aria-hidden="true">
          <polygon points={outline.map((p) => p.join(',')).join(' ')} strokeWidth={size * 0.032} />
        </svg>
      ) : (
        <span className="rc-track empty" aria-hidden="true" />
      )}
      <h3 className="rc-name" title={r.eventName}>
        {shortName(r.eventName)}
      </h3>
      <p className="rc-place">
        {r.locality}, {r.country}
      </p>
      <div className="rc-foot">
        {done && result && result.podium.length > 0 ? (
          <>
            <div className="rc-podium" aria-label="Pódio">
              {result.podium.map((p, i) => (
                <span key={p.driver}>
                  <i style={{ background: p.teamColor ?? 'var(--muted)' }} />
                  <em>{i + 1}</em>
                  {p.driver}
                </span>
              ))}
            </div>
            <div className="rc-meta">
              <span>{result.pole && <>Pole <b>{result.pole.driver}</b></>}</span>
              {links.length > 0 && (
                <span className="rc-links">
                  {links.map((s) => (
                    <a key={s.path} href={routeHref({ view: 'session', path: s.path })}>
                      {sessionLabel(s.session)} →
                    </a>
                  ))}
                </span>
              )}
            </div>
          </>
        ) : race ? (
          <p className="rc-when">
            Corrida <b>{dateTime(race)}</b>
          </p>
        ) : (
          <p className="rc-when muted">Data a definir</p>
        )}
      </div>
    </li>
  )
}
