import { useEffect, useMemo, useState } from 'react'
import TelemetryCharts from '../components/TelemetryCharts'
import { formatLapTime, loadTelemetry, loadTrack } from '../lib/data'
import { makeProjection } from '../lib/replay'
import { compareLaps, fastestLap, similarColors, textOn } from '../lib/telemetry'
import type { DriverResult, DriverTelemetry, Lap, SessionMeta, Track } from '../types/data'

interface Props {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
}

interface Pick {
  driver: string
  lap: number
}

const COMPOUND_LETTER: Record<string, string> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' }

function defaultPicks(laps: Lap[], results: DriverResult[], available: string[]): [Pick | null, Pick | null] {
  const best = fastestLap(laps.filter((l) => available.includes(l.driver)))
  if (!best) return [null, null]
  const a = { driver: best.driver, lap: best.lap! }
  // B: volta mais rápida do vencedor (ou do 2º colocado, se o vencedor for o próprio A)
  const ordered = [...results].sort((x, y) => (x.position ?? 99) - (y.position ?? 99))
  const other = ordered.find((r) => r.driver !== a.driver && available.includes(r.driver))
  const bLap = other ? fastestLap(laps, other.driver) : null
  return [a, bLap ? { driver: bLap.driver, lap: bLap.lap! } : null]
}

export default function TelemetryView({ path, meta, results, laps }: Props) {
  const available = meta.telemetry
  const [initialA, initialB] = useMemo(() => defaultPicks(laps, results, available), [laps, results, available])
  const [pickA, setPickA] = useState<Pick | null>(initialA)
  const [pickB, setPickB] = useState<Pick | null>(initialB)
  const [cache, setCache] = useState<Record<string, DriverTelemetry>>({})
  const [track, setTrack] = useState<Track | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    loadTrack(path).then(setTrack).catch(() => setTrack(null))
  }, [path])

  // baixa a telemetria só dos pilotos escolhidos (e guarda em cache)
  useEffect(() => {
    for (const p of [pickA, pickB]) {
      if (!p || cache[p.driver]) continue
      loadTelemetry(path, p.driver)
        .then((t) => setCache((c) => ({ ...c, [t.driver]: t })))
        .catch((e: Error) => setError(e.message))
    }
  }, [path, pickA, pickB, cache])

  const lapA = pickA ? cache[pickA.driver]?.laps.find((l) => l.lap === pickA.lap) : undefined
  const lapB = pickB ? cache[pickB.driver]?.laps.find((l) => l.lap === pickB.lap) : undefined
  const comparison = useMemo(() => (lapA && lapB ? compareLaps(lapA, lapB) : null), [lapA, lapB])

  const resultBy = useMemo(() => new Map(results.map((r) => [r.driver, r])), [results])
  const colorA = resultBy.get(pickA?.driver ?? '')?.teamColor ?? '#e10600'
  const rawB = resultBy.get(pickB?.driver ?? '')?.teamColor ?? '#3671c6'
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ececf0'
  const colorB = similarColors(colorA, rawB) ? textColor : rawB

  const lapInfoA = laps.find((l) => l.driver === pickA?.driver && l.lap === pickA?.lap)
  const lapInfoB = laps.find((l) => l.driver === pickB?.driver && l.lap === pickB?.lap)

  if (available.length === 0) return <p className="notice">Esta sessão não tem telemetria exportada.</p>
  if (error) return <p className="notice error">{error}</p>

  const swap = () => {
    setPickA(pickB)
    setPickB(pickA)
  }

  const i = hover
  const at = comparison && i != null ? comparison : null

  return (
    <div className="telemetry">
      <div className="lap-pickers">
        <LapPicker
          tag="A"
          color={colorA}
          pick={pickA}
          onChange={setPickA}
          laps={laps}
          results={results}
          available={available}
        />
        <button className="icon-btn swap" onClick={swap} aria-label="Trocar A e B" title="Trocar A e B">
          ⇄
        </button>
        <LapPicker
          tag="B"
          color={colorB}
          pick={pickB}
          onChange={setPickB}
          laps={laps}
          results={results}
          available={available}
        />
      </div>

      {!comparison && <p className="notice">Carregando telemetria…</p>}

      {comparison && lapA && lapB && (
        <>
          <div className="tele-summary">
            <div className="summary-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">Volta</th>
                    <th className="num">S1</th>
                    <th className="num">S2</th>
                    <th className="num">S3</th>
                    <th className="num">V. máx</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { tag: 'A', color: colorA, pick: pickA!, info: lapInfoA, lap: lapA },
                    { tag: 'B', color: colorB, pick: pickB!, info: lapInfoB, lap: lapB },
                  ].map((row) => (
                    <tr key={row.tag}>
                      <td>
                        <span className="driver">
                          <span className="team-bar" style={{ background: row.color }} />
                          <strong>{row.pick.driver}</strong>
                          <span className="muted">V{row.pick.lap}</span>
                        </span>
                      </td>
                      <td className="num mono">{formatLapTime(row.lap.lapTime)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector1 ?? null)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector2 ?? null)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector3 ?? null)}</td>
                      <td className="num mono">{Math.max(...row.lap.speed)}</td>
                    </tr>
                  ))}
                  <tr className="diff-row">
                    <td className="muted">B − A</td>
                    <Diff a={lapA.lapTime} b={lapB.lapTime} />
                    <Diff a={lapInfoA?.sector1} b={lapInfoB?.sector1} />
                    <Diff a={lapInfoA?.sector2} b={lapInfoB?.sector2} />
                    <Diff a={lapInfoA?.sector3} b={lapInfoB?.sector3} />
                    <td className="num mono muted">
                      {Math.max(...lapB.speed) - Math.max(...lapA.speed) > 0 ? '+' : ''}
                      {Math.max(...lapB.speed) - Math.max(...lapA.speed)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {track && <MiniMap track={track} distance={at ? at.d[i!] : null} />}
          </div>

          <div className="readout" aria-live="off">
            {at ? (
              <>
                <span>
                  <b>{(at.d[i!] / 1000).toFixed(2)} km</b>
                </span>
                <span>
                  Δ <b>{at.delta[i!] > 0 ? '+' : ''}{at.delta[i!].toFixed(2)} s</b>
                </span>
                <span>
                  <i style={{ background: colorA }} /> {Math.round(at.a.speed[i!])} km/h · {at.a.gear[i!]}ª ·{' '}
                  {Math.round(at.a.throttle[i!])}%{at.a.brake[i!] ? ' · freio' : ''}
                  {at.a.drs[i!] ? ' · DRS' : ''}
                </span>
                <span>
                  <i style={{ background: colorB }} /> {Math.round(at.b.speed[i!])} km/h · {at.b.gear[i!]}ª ·{' '}
                  {Math.round(at.b.throttle[i!])}%{at.b.brake[i!] ? ' · freio' : ''}
                  {at.b.drs[i!] ? ' · DRS' : ''}
                </span>
              </>
            ) : (
              <span className="muted">
                Passe o mouse nos gráficos para ver os valores. Arraste para dar zoom; duplo clique volta ao normal.
              </span>
            )}
          </div>

          <TelemetryCharts
            comparison={comparison}
            colorA={colorA}
            colorB={colorB}
            corners={track?.corners ?? []}
            onHover={setHover}
          />
          <p className="foot">
            Voltas alinhadas por distância a cada 5 m. A diferença é o tempo acumulado de B menos o de A no mesmo ponto
            da pista. Dados do carro a ~4 Hz.
          </p>
        </>
      )}
    </div>
  )
}

function Diff({ a, b }: { a: number | null | undefined; b: number | null | undefined }) {
  if (a == null || b == null) return <td className="num mono muted">—</td>
  const d = b - a
  return (
    <td className={`num mono ${d > 0 ? 'down' : d < 0 ? 'up' : ''} delta`}>
      {d > 0 ? '+' : ''}
      {d.toFixed(3)}
    </td>
  )
}

function LapPicker({
  tag,
  color,
  pick,
  onChange,
  laps,
  results,
  available,
}: {
  tag: string
  color: string
  pick: Pick | null
  onChange: (p: Pick) => void
  laps: Lap[]
  results: DriverResult[]
  available: string[]
}) {
  const drivers = [...results]
    .filter((r) => available.includes(r.driver))
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const driverLaps = laps
    .filter((l) => l.driver === pick?.driver && l.lapTime != null && l.lap != null)
    .sort((a, b) => a.lap! - b.lap!)
  const best = fastestLap(driverLaps)

  return (
    <div className="lap-picker" style={{ borderColor: color }}>
      <span className="picker-tag" style={{ background: color, color: textOn(color) }}>
        {tag}
      </span>
      <select
        value={pick?.driver ?? ''}
        aria-label={`Piloto ${tag}`}
        onChange={(e) => {
          const fl = fastestLap(laps, e.target.value)
          if (fl) onChange({ driver: e.target.value, lap: fl.lap! })
        }}
      >
        {drivers.map((r) => (
          <option key={r.driver} value={r.driver}>
            {r.driver} · {r.fullName}
          </option>
        ))}
      </select>
      <select
        value={pick?.lap ?? ''}
        aria-label={`Volta ${tag}`}
        onChange={(e) => pick && onChange({ driver: pick.driver, lap: Number(e.target.value) })}
      >
        {driverLaps.map((l) => (
          <option key={l.lap} value={l.lap!}>
            V{l.lap} · {formatLapTime(l.lapTime)} · {COMPOUND_LETTER[l.compound ?? ''] ?? '?'}
            {l.lap === best?.lap ? ' · mais rápida' : ''}
            {l.pitIn || l.pitOut ? ' · box' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function MiniMap({ track, distance }: { track: Track; distance: number | null }) {
  const proj = useMemo(() => makeProjection(track, 0.08), [track])
  const points = useMemo(
    () => track.outline.map(([x, y]) => proj.project(x, y).map((v) => v.toFixed(1)).join(',')).join(' '),
    [track, proj],
  )
  let marker: [number, number] | null = null
  if (distance != null) {
    const idx = Math.max(0, Math.min(track.outline.length - 1, Math.round(distance / 10)))
    const [x, y] = track.outline[idx]
    marker = proj.project(x, y)
  }
  const [sx, sy] = proj.project(track.outline[0][0], track.outline[0][1])
  return (
    <svg viewBox={proj.viewBox} className="mini-map" role="img" aria-label="Posição na pista">
      <polygon points={points} fill="none" className="track-outer" strokeWidth={proj.size * 0.025} />
      <circle cx={sx} cy={sy} r={proj.size * 0.015} className="mini-start" />
      {marker && <circle cx={marker[0]} cy={marker[1]} r={proj.size * 0.03} className="mini-marker" />}
    </svg>
  )
}
