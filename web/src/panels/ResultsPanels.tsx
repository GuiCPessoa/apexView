import { Fragment, useMemo } from 'react'
import { formatGap, formatLapTime } from '../lib/data'
import { dimmed } from '../lib/focus'
import { rankingByBestLap, reachedSegment } from '../lib/session'
import type { DriverResult, Lap, SessionMeta } from '../types/data'
import type { FocusProps } from './RacePanels'

const COMPOUND_LETTER: Record<string, string> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' }
const COMPOUND_CLASS: Record<string, string> = { SOFT: 'soft', MEDIUM: 'medium', HARD: 'hard', INTERMEDIATE: 'inter', WET: 'wet' }

export function TyreBadge({ compound }: { compound: string | null }) {
  if (!compound || !COMPOUND_LETTER[compound]) return <span className="muted">—</span>
  return (
    <span className={`tyre ${COMPOUND_CLASS[compound]}`} title={compound}>
      {COMPOUND_LETTER[compound]}
    </span>
  )
}

function DriverCell({ r }: { r: DriverResult }) {
  return (
    <span className="driver">
      <span className="team-bar" style={{ background: r.teamColor ?? 'var(--muted)' }} />
      <strong>{r.driver}</strong>
      <span className="team-name">{r.team}</span>
    </span>
  )
}

/** Classificação (Q e SQ): tempos de Q1/Q2/Q3, diferença para a pole e cortes de eliminação. */
const rowClass = (focus: string[], driver: string) =>
  `clickable ${focus.includes(driver) ? 'focused' : ''} ${dimmed(focus, driver) ? 'dim' : ''}`

export function QualifyingResults({
  meta,
  results,
  focus,
  onToggle,
}: { meta: SessionMeta; results: DriverResult[] } & FocusProps) {
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const prefix = meta.session === 'SQ' ? 'SQ' : 'Q'
  const pole = sorted[0]?.q3 ?? sorted[0]?.q2 ?? sorted[0]?.q1 ?? null
  const fastest = (key: 'q1' | 'q2' | 'q3') =>
    results.reduce<number | null>((m, r) => (r[key] != null && (m == null || r[key]! < m) ? r[key] : m), null)
  const best = { q1: fastest('q1'), q2: fastest('q2'), q3: fastest('q3') }

  return (
    <div className="table-wrap">
      <table className="compact quali-results">
        <thead>
          <tr>
            <th className="num">Pos</th>
            <th>Piloto</th>
            <th className="num">{prefix}1</th>
            <th className="num">{prefix}2</th>
            <th className="num">{prefix}3</th>
            <th className="num hide-sm">Dif.</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const seg = reachedSegment(r)
            const prevSeg = i > 0 ? reachedSegment(sorted[i - 1]) : 3
            const own = seg === 3 ? r.q3 : seg === 2 ? r.q2 : r.q1
            return (
              <Fragment key={r.driver}>
                {seg < prevSeg && (
                  <tr className="cut-row">
                    <td colSpan={6}>Eliminados no {prefix}{seg}</td>
                  </tr>
                )}
                <tr className={rowClass(focus, r.driver)} onClick={() => onToggle(r.driver)}>
                  <td className="num pos">{r.position ?? '—'}</td>
                  <td>
                    <DriverCell r={r} />
                  </td>
                  {(['q1', 'q2', 'q3'] as const).map((k) => (
                    <td key={k} className={`num mono ${r[k] != null && r[k] === best[k] ? 'fastest' : ''}`}>
                      {r[k] != null ? formatLapTime(r[k]) : ''}
                    </td>
                  ))}
                  <td className="num mono muted hide-sm">{own != null && pole != null ? formatGap(own - pole) : '—'}</td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Treinos: ordem pela melhor volta válida (o FastF1 não dá posição oficial nos treinos). */
export function PracticeResults({
  results,
  laps,
  focus,
  onToggle,
}: { results: DriverResult[]; laps: Lap[] } & FocusProps) {
  const ranking = useMemo(() => rankingByBestLap(laps, results.map((r) => r.driver)), [laps, results])
  const by = new Map(results.map((r) => [r.driver, r]))
  return (
    <div className="table-wrap">
      <table className="compact">
        <thead>
          <tr>
            <th className="num">Pos</th>
            <th>Piloto</th>
            <th className="num">Melhor volta</th>
            <th className="num">Dif.</th>
            <th className="num">Voltas</th>
            <th className="hide-sm">Pneu</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((row, i) => {
            const r = by.get(row.driver)!
            return (
              <tr key={row.driver} className={rowClass(focus, row.driver)} onClick={() => onToggle(row.driver)}>
                <td className="num pos">{row.best ? i + 1 : '—'}</td>
                <td>
                  <DriverCell r={r} />
                </td>
                <td className={`num mono ${i === 0 ? 'fastest' : ''}`}>{formatLapTime(row.best?.lapTime ?? null)}</td>
                <td className="num mono muted">{formatGap(row.gap)}</td>
                <td className="num">{row.laps}</td>
                <td className="hide-sm">
                  <TyreBadge compound={row.best?.compound ?? null} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
