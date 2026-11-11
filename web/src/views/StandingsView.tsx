import { formatPoints, loadCalendar, loadStandings } from '../lib/data'
import { useAsync } from '../lib/route'
import type { DataIndex } from '../types/data'

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
  const lastRound = calendar.rounds.find((r) => r.round === standings.afterRound)
  const total = calendar.rounds.length
  const finished = standings.afterRound >= total
  const leaderDrivers = standings.drivers[0]?.points || 1
  const leaderTeams = standings.constructors[0]?.points || 1

  return (
    <section>
      <div className="section-head">
        <h1>Campeonato {year}</h1>
        <p>
          {finished ? 'Classificação final' : `Após a rodada ${standings.afterRound} de ${total}`}
          {lastRound && ` · ${lastRound.eventName}`}
        </p>
      </div>

      <div className="standings-grid">
        <div>
          <h2>Pilotos</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Pos</th>
                  <th>Piloto</th>
                  <th className="hide-sm">Equipe</th>
                  <th className="num hide-sm">Vit.</th>
                  <th className="num">Pts</th>
                  <th className="num">Dif.</th>
                </tr>
              </thead>
              <tbody>
                {standings.drivers.map((d) => (
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
                    <td className="hide-sm muted" title={d.teams.length > 1 ? `Na temporada: ${d.teams.join(', ')}` : undefined}>
                      {d.teams[d.teams.length - 1]}
                      {d.teams.length > 1 && '*'}
                    </td>
                    <td className="num hide-sm">{d.wins || ''}</td>
                    <td className="num points">
                      <PointsBar value={d.points} max={leaderDrivers} color={d.teamColor} />
                      {formatPoints(d.points)}
                    </td>
                    <td className="num muted">
                      {d.points === leaderDrivers ? '' : `−${formatPoints(leaderDrivers - d.points)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2>Construtores</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Pos</th>
                  <th>Equipe</th>
                  <th className="num hide-sm">Vit.</th>
                  <th className="num">Pts</th>
                  <th className="num">Dif.</th>
                </tr>
              </thead>
              <tbody>
                {standings.constructors.map((c) => (
                  <tr key={c.constructorId}>
                    <td className="num pos">{c.position ?? '—'}</td>
                    <td>
                      <span className="driver">
                        <span className="team-bar" style={{ background: c.teamColor ?? 'var(--muted)' }} />
                        <strong>{c.team}</strong>
                      </span>
                    </td>
                    <td className="num hide-sm">{c.wins || ''}</td>
                    <td className="num points">
                      <PointsBar value={c.points} max={leaderTeams} color={c.teamColor} />
                      {formatPoints(c.points)}
                    </td>
                    <td className="num muted">
                      {c.points === leaderTeams ? '' : `−${formatPoints(leaderTeams - c.points)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="foot">
        Dados: Jolpica-F1 · gerado em {new Date(standings.generatedAt).toLocaleString('pt-BR')}
      </p>
    </section>
  )
}

function PointsBar({ value, max, color }: { value: number; max: number; color: string | null }) {
  return (
    <span className="points-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, (value / max) * 100)}%`, background: color ?? 'var(--muted)' }} />
    </span>
  )
}
