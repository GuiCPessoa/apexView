import { useState } from 'react'
import Card from '../components/Card'
import { formatPoints, loadCalendar, loadStandings } from '../lib/data'
import { useAsync } from '../lib/route'
import { daysUntil, lineColors, raceStart, spreadLabels, titleRace, type TitleRace } from '../lib/standings'
import type { Calendar, ConstructorStanding, DataIndex, DriverStanding, Standings } from '../types/data'

const CHART_DRIVERS = 6

export default function StandingsView({ year, index }: { year: number; index: DataIndex }) {
  const hasSeason = index.seasons.some((s) => s.year === year)
  const { data, error } = useAsync(
    hasSeason ? () => Promise.all([loadStandings(year), loadCalendar(year)]) : null,
    [year, hasSeason],
  )

  if (!hasSeason) return <p className="notice">Temporada {year} não exportada.</p>
  if (error) return <p className="notice error">{error}</p>
  if (!data) return <p className="notice">Carregando…</p>

  const [standings, calendar] = data
  const title = titleRace(standings, calendar)

  return (
    <section className="standings">
      <Hero s={standings} c={calendar} t={title} />
      <div className="dash">
        {standings.drivers.slice(0, 3).map((d, i) => (
          <PodiumCard key={d.driver} d={d} rank={i + 1} leader={standings.drivers[0]} />
        ))}
        <DriversCard s={standings} />
        <ConstructorsCard s={standings} />
        {standings.history && <EvolutionCard s={standings} total={calendar.rounds.length} />}
        <WinnersCard s={standings} c={calendar} t={title} />
      </div>
      <p className="foot">
        Dados: Jolpica-F1 · gerado em {new Date(standings.generatedAt).toLocaleString('pt-BR')}
      </p>
    </section>
  )
}

// ---------- Destaque ----------

function Hero({ s, c, t }: { s: Standings; c: Calendar; t: TitleRace }) {
  const [p1, p2] = s.drivers
  const [c1, c2] = s.constructors
  const next = t.remaining[0]
  const nextStart = next ? raceStart(next) : null
  const races = t.remaining.length
  const [now] = useState(() => new Date())
  return (
    <div className="hero">
      <div className="hero-title">
        <span className="kicker">
          <span className="muted">Temporada {s.year} · </span>
          {t.finished ? 'classificação final' : `após a rodada ${s.afterRound} de ${c.rounds.length}`}
        </span>
        <h1>{p1 ? `${p1.familyName} ${t.driverDecided ? 'é campeão' : 'lidera'}` : `Campeonato ${s.year}`}</h1>
        {p1 && p2 && (
          <p>
            {t.finished ? (
              <>
                Título com <strong>{formatPoints(t.driverLead)} pts</strong> de vantagem sobre {p2.familyName}.
              </>
            ) : t.driverDecided ? (
              <>
                Decidido matematicamente: <strong>{formatPoints(t.driverLead)} pts</strong> de vantagem e só{' '}
                <strong>{t.maxDriver}</strong> em jogo {races === 1 ? 'na última corrida' : `nas ${races} corridas restantes`}.
              </>
            ) : (
              <>
                <strong>{formatPoints(t.driverLead)} pts</strong> à frente de {p2.familyName}, com <strong>{t.maxDriver}</strong> ainda
                em jogo.
              </>
            )}
          </p>
        )}
      </div>
      <div className="hero-stats">
        {c1 && (
          <div className="stat">
            <span className="stat-label">Construtores</span>
            <span className="stat-value">{c1.team}</span>
            <span className="stat-sub">
              {t.teamDecided && <span className="champ-badge">Campeã</span>}
              {c2 ? `+${formatPoints(t.teamLead)} sobre ${c2.team}` : ''}
            </span>
          </div>
        )}
        {next && (
          <div className="stat">
            <span className="stat-label">Próxima corrida</span>
            <span className="stat-value">{next.locality}</span>
            <span className="stat-sub">
              {nextStart
                ? `${nextStart.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${daysUntil(nextStart, now)}`
                : next.eventName}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Top 3 ----------

function PodiumCard({ d, rank, leader }: { d: DriverStanding; rank: number; leader: DriverStanding }) {
  return (
    <section className={`card span-4 podium-card ${rank === 1 ? 'leader' : ''}`}>
      <span className="podium-stripe" style={{ background: d.teamColor ?? 'var(--muted)' }} />
      <span className="podium-rank" aria-hidden="true">
        {rank}
      </span>
      <div className="podium-code">
        {d.driver}
        {d.number ? ` · #${d.number}` : ''}
      </div>
      <div className="podium-name">
        <span>{d.givenName}</span>
        {d.familyName}
      </div>
      <div className="muted podium-team">{d.teams[d.teams.length - 1]}</div>
      <div className="podium-points">
        {formatPoints(d.points)}
        <small>pts</small>
        {rank > 1 && <small>−{formatPoints(leader.points - d.points)}</small>}
      </div>
      <div className="podium-mini">
        <div>
          <b>{d.wins}</b>vitórias
        </div>
        {d.podiums != null && (
          <div>
            <b>{d.podiums}</b>pódios
          </div>
        )}
        {d.poles != null && (
          <div>
            <b>{d.poles}</b>poles
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- Pilotos ----------

function Form({ form }: { form: (number | null)[] }) {
  return (
    <span className="form" aria-label={`Últimas corridas: ${form.map((p) => (p == null ? 'abandono' : `P${p}`)).join(', ')}`}>
      {form.map((p, i) =>
        p == null ? (
          <i key={i} className="out">
            AB
          </i>
        ) : (
          <i key={i} className={p === 1 ? 'win' : p <= 3 ? 'podium' : undefined}>
            {p}
          </i>
        ),
      )}
    </span>
  )
}

function DriversCard({ s }: { s: Standings }) {
  const leader = s.drivers[0]?.points || 1
  const hasStats = s.drivers.some((d) => d.form)
  return (
    <Card title="Pilotos" span={8} aside={hasStats ? 'forma = últimas 5 corridas' : undefined}>
      <div className="table-wrap">
        <table className="compact standings-table">
          <thead>
            <tr>
              <th className="num">Pos</th>
              <th>Piloto</th>
              <th className="col-team">Equipe</th>
              {hasStats && <th className="col-form">Forma</th>}
              <th className="num">V</th>
              {hasStats && <th className="num col-podiums">Pód</th>}
              <th className="num">Pts</th>
              <th className="num">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {s.drivers.map((d) => (
              <tr key={d.driver + d.familyName}>
                <td className="num pos">{d.position ?? '—'}</td>
                <td>
                  <span className="driver">
                    <span className="team-bar" style={{ background: d.teamColor ?? 'var(--muted)' }} />
                    <strong>{d.driver}</strong>
                    <span className="full-name">
                      {d.givenName} {d.familyName}
                    </span>
                  </span>
                </td>
                <td className="muted col-team" title={d.teams.length > 1 ? `Na temporada: ${d.teams.join(', ')}` : undefined}>
                  {d.teams[d.teams.length - 1]}
                  {d.teams.length > 1 && '*'}
                </td>
                {hasStats && <td className="col-form">{d.form && <Form form={d.form} />}</td>}
                <td className="num">{d.wins || ''}</td>
                {hasStats && <td className="num col-podiums">{d.podiums || ''}</td>}
                <td className="num points">
                  <PointsBar value={d.points} max={leader} color={d.teamColor} />
                  {formatPoints(d.points)}
                </td>
                <td className="num muted">{d.points === leader ? '' : `−${formatPoints(leader - d.points)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PointsBar({ value, max, color }: { value: number; max: number; color: string | null }) {
  return (
    <span className="points-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, (value / max) * 100)}%`, background: color ?? 'var(--muted)' }} />
    </span>
  )
}

// ---------- Construtores ----------

function ConstructorsCard({ s }: { s: Standings }) {
  const leader = s.constructors[0]?.points || 1
  const split = s.constructors.some((c) => c.drivers)
  return (
    <Card title="Construtores" span={4} aside={split ? 'pontos por piloto' : undefined}>
      <ol className="constructors">
        {s.constructors.map((c) => (
          <ConstructorRow key={c.constructorId} c={c} leader={leader} />
        ))}
      </ol>
    </Card>
  )
}

function ConstructorRow({ c, leader }: { c: ConstructorStanding; leader: number }) {
  const scorers = (c.drivers ?? []).filter((d) => d.points > 0)
  const color = c.teamColor ?? 'var(--muted)'
  return (
    <li>
      <div className="constructor-row">
        <b>{c.position ?? '—'}</b>
        <span className="constructor-name">{c.team}</span>
        {c.wins > 0 && <span className="muted">{c.wins} V</span>}
        <span className="points">{formatPoints(c.points)}</span>
      </div>
      <div className="split-bar" style={{ width: `${Math.max(2, (c.points / leader) * 100)}%` }}>
        {scorers.length ? (
          scorers.map((d, i) => (
            <span key={d.driver} style={{ flex: d.points, background: color, opacity: Math.max(0.35, 1 - i * 0.35) }} title={`${d.driver}: ${formatPoints(d.points)} pts`} />
          ))
        ) : (
          <span style={{ flex: 1, background: color }} />
        )}
      </div>
      {scorers.length > 0 && <div className="split-legend">{scorers.map((d) => `${d.driver} ${formatPoints(d.points)}`).join(' · ')}</div>}
    </li>
  )
}

// ---------- Evolução ----------

function EvolutionCard({ s, total }: { s: Standings; total: number }) {
  const history = s.history!
  const drivers = s.drivers.slice(0, CHART_DRIVERS).filter((d) => history.points[d.driver])
  const colors = lineColors(drivers)
  const W = 760
  const H = 280
  const [L, R, T, B] = [36, 44, 12, 26]
  const lastRound = history.rounds[history.rounds.length - 1] ?? 0
  const maxY = Math.max(50, Math.ceil(Math.max(...drivers.map((d) => Math.max(...history.points[d.driver]))) / 50) * 50)
  const step = maxY > 300 ? 100 : 50
  const X = (r: number) => L + ((r - 1) / Math.max(1, total - 1)) * (W - L - R)
  const Y = (v: number) => T + (1 - v / maxY) * (H - T - B)
  const ends = drivers.map((d) => {
    const pts = history.points[d.driver]
    return Y(pts[pts.length - 1])
  })
  const labels = spreadLabels(ends, 13)

  return (
    <Card
      title="Evolução do campeonato"
      span={8}
      aside={
        <span className="chips">
          {drivers.map((d) => (
            <span key={d.driver} className="chip on">
              <i style={{ background: colors[d.driver] }} />
              {d.driver}
            </span>
          ))}
        </span>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="evolution" role="img" aria-label="Pontos acumulados dos seis primeiros, rodada a rodada">
        {Array.from({ length: Math.floor(maxY / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis">
              {v}
            </text>
          </g>
        ))}
        {lastRound < total && (
          <g>
            <rect x={X(lastRound)} y={T} width={X(total) - X(lastRound)} height={H - T - B} className="future" />
            <text x={X(total) - 4} y={T + 14} textAnchor="end" className="axis">
              a disputar
            </text>
          </g>
        )}
        {Array.from({ length: total }, (_, i) => i + 1)
          .filter((r) => r === 1 || r % 4 === 0 || r === total)
          .map((r) => (
            <text key={r} x={X(r)} y={H - 8} textAnchor="middle" className="axis">
              R{r}
            </text>
          ))}
        {[...drivers].reverse().map((d) => {
          const pts = history.points[d.driver]
          const i = drivers.indexOf(d)
          const color = colors[d.driver]
          const x = X(history.rounds[pts.length - 1])
          return (
            <g key={d.driver}>
              <polyline
                fill="none"
                stroke={color}
                strokeWidth={i === 0 ? 3 : 2}
                strokeLinejoin="round"
                points={pts.map((v, k) => `${X(history.rounds[k])},${Y(v)}`).join(' ')}
              />
              <circle cx={x} cy={ends[i]} r={3.5} fill={color} />
              <text x={x + 7} y={labels[i] + 4} fill={color} className="end-label">
                {d.driver}
              </text>
            </g>
          )
        })}
      </svg>
    </Card>
  )
}

// ---------- Vencedores ----------

function WinnersCard({ s, c, t }: { s: Standings; c: Calendar; t: TitleRace }) {
  if (!s.winners) return null
  const next = t.remaining[0]
  return (
    <Card title="Vencedores" span={4} aside={`${c.rounds.length} rodadas`}>
      <ol className="winners">
        {c.rounds.map((r) => {
          const w = s.winners!.find((x) => x.round === r.round)
          return w ? (
            <li key={r.round} style={{ borderTopColor: w.teamColor ?? 'var(--muted)' }} title={`${r.eventName}: ${w.driver} (${w.team ?? ''})`}>
              <small>R{r.round}</small>
              <b>{w.driver}</b>
            </li>
          ) : (
            <li key={r.round} className={`future ${r === next ? 'next' : ''}`} title={r.eventName}>
              <small>R{r.round}</small>
              <b>{r.country}</b>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
