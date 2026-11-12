import { useEffect, useMemo, useState } from 'react'
import Card from '../components/Card'
import TelemetryCharts from '../components/TelemetryCharts'
import { formatLapTime, loadTelemetry, loadTrack } from '../lib/data'
import { telemetryPair } from '../lib/focus'
import { makeProjection } from '../lib/replay'
import { compareLaps, fastestLap, similarColors, textOn } from '../lib/telemetry'
import type { DriverResult, DriverTelemetry, Lap, SessionMeta, Track } from '../types/data'

interface Props {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
  focus: string[]
  /** Trocar o piloto A ou B no seletor muda o foco do painel inteiro. */
  onFocusChange: (focus: string[]) => void
  span: 8 | 12
}

const COMPOUND_LETTER: Record<string, string> = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' }

/** Par padrão: dono da volta mais rápida e o mais bem colocado depois dele. */
function defaultPair(laps: Lap[], results: DriverResult[], available: string[]): [string | null, string | null] {
  const best = fastestLap(laps.filter((l) => available.includes(l.driver)))
  if (!best) return [null, null]
  const ordered = [...results].sort((x, y) => (x.position ?? 99) - (y.position ?? 99))
  const other = ordered.find((r) => r.driver !== best.driver && available.includes(r.driver))
  return [best.driver, other?.driver ?? null]
}

export default function TelemetryPanel({ path, meta, results, laps, focus, onFocusChange, span }: Props) {
  const available = meta.telemetry
  const defaults = useMemo(() => defaultPair(laps, results, available), [laps, results, available])
  const [driverA, pairB] = telemetryPair(focus, defaults, available)
  // "só A": telemetria de um piloto, sem comparação. Pôr um segundo piloto em foco volta a comparar.
  const [solo, setSolo] = useState(false)
  if (solo && focus.length >= 2) setSolo(false) // ajuste durante o render: sem efeito nem render extra em cascata
  const driverB = solo ? null : pairB
  // volta escolhida por piloto; sem escolha, a mais rápida dele
  const [lapChoice, setLapChoice] = useState<Record<string, number>>({})
  // (quem abandonou cedo pode não ter nenhuma volta cronometrada: usa a primeira volta que tiver)
  const lapOf = (d: string | null) =>
    d ? (lapChoice[d] ?? fastestLap(laps, d)?.lap ?? laps.find((l) => l.driver === d && l.lap != null)?.lap ?? null) : null
  const lapNumA = lapOf(driverA)
  const lapNumB = lapOf(driverB)

  const [cache, setCache] = useState<Record<string, DriverTelemetry>>({})
  const [track, setTrack] = useState<Track | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    loadTrack(path).then(setTrack).catch(() => setTrack(null))
  }, [path])

  // baixa a telemetria só dos pilotos escolhidos (e guarda em cache)
  useEffect(() => {
    for (const d of [driverA, driverB]) {
      if (!d || cache[d]) continue
      loadTelemetry(path, d)
        .then((t) => setCache((c) => ({ ...c, [t.driver]: t })))
        .catch((e: Error) => setError(e.message))
    }
  }, [path, driverA, driverB, cache])

  const lapA = driverA ? cache[driverA]?.laps.find((l) => l.lap === lapNumA) : undefined
  const lapB = driverB ? cache[driverB]?.laps.find((l) => l.lap === lapNumB) : undefined
  const comparison = useMemo(() => {
    if (!lapA) return null
    if (!driverB) return compareLaps(lapA, null)
    return lapB ? compareLaps(lapA, lapB) : null
  }, [lapA, lapB, driverB])

  // telemetria do piloto já chegou, mas não traz a volta escolhida
  const missing = [
    driverA && cache[driverA] && !lapA ? driverA : null,
    driverB && cache[driverB] && !lapB ? driverB : null,
  ].filter((d): d is string => d != null)

  const resultBy = useMemo(() => new Map(results.map((r) => [r.driver, r])), [results])
  const colorA = resultBy.get(driverA ?? '')?.teamColor ?? '#e10600'
  const rawB = resultBy.get(driverB ?? '')?.teamColor ?? '#3671c6'
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ececf0'
  const colorB = similarColors(colorA, rawB) ? textColor : rawB

  const lapInfoA = laps.find((l) => l.driver === driverA && l.lap === lapNumA)
  const lapInfoB = laps.find((l) => l.driver === driverB && l.lap === lapNumB)

  const setDriver = (slot: 0 | 1, d: string) => {
    const pair = [driverA, driverB]
    pair[slot] = d
    if (pair[1 - slot] === d) pair[1 - slot] = slot === 0 ? driverA : driverB // escolheu o outro: troca
    onFocusChange(pair.filter((x): x is string => x != null))
  }
  const swap = () => onFocusChange([driverB, driverA].filter((x): x is string => x != null))
  const chooseB = (d: string) => {
    if (d === '') {
      setSolo(true)
      onFocusChange(driverA ? [driverA] : [])
    } else {
      setSolo(false)
      setDriver(1, d)
    }
  }

  const title = 'Telemetria'
  if (available.length === 0) {
    return (
      <Card title={title} span={span} id="telemetry">
        <p className="muted">Esta sessão não tem telemetria exportada.</p>
      </Card>
    )
  }

  const i = hover
  const at = comparison && i != null ? comparison : null

  return (
    <Card
      title={title}
      span={span}
      id="telemetry"
      aside={<span className="muted">{driverB ? 'clique em dois pilotos para comparar' : 'só um piloto · escolha B para comparar'}</span>}
    >
      {error && <p className="notice error">{error}</p>}
      <div className="lap-pickers">
        <LapPicker
          tag="A"
          color={colorA}
          driver={driverA}
          lap={lapNumA}
          onDriver={(d) => setDriver(0, d)}
          onLap={(l) => driverA && setLapChoice((c) => ({ ...c, [driverA]: l }))}
          laps={laps}
          results={results}
          available={available}
        />
        <button className="icon-btn swap" onClick={swap} disabled={!driverB} aria-label="Trocar A e B" title="Trocar A e B">
          ⇄
        </button>
        <LapPicker
          tag="B"
          color={driverB ? colorB : 'var(--muted)'}
          driver={driverB}
          lap={lapNumB}
          onDriver={chooseB}
          onLap={(l) => driverB && setLapChoice((c) => ({ ...c, [driverB]: l }))}
          laps={laps}
          results={results}
          available={available}
          noneLabel="Nenhum · só o piloto A"
        />
      </div>

      {!comparison && !error && (missing.length > 0 ? (
        <p className="muted">Sem telemetria para a volta escolhida de {missing.join(' e ')}.</p>
      ) : (
        <p className="muted loading">Carregando telemetria…</p>
      ))}

      {comparison && lapA && (
        <>
          <div className="tele-summary">
            <div className="table-wrap">
              <table className="compact">
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
                    { tag: 'A', color: colorA, driver: driverA!, n: lapNumA, info: lapInfoA, lap: lapA },
                    ...(driverB && lapB ? [{ tag: 'B', color: colorB, driver: driverB, n: lapNumB, info: lapInfoB, lap: lapB }] : []),
                  ].map((row) => (
                    <tr key={row.tag}>
                      <td>
                        <span className="driver">
                          <span className="team-bar" style={{ background: row.color }} />
                          <strong>{row.driver}</strong>
                          <span className="muted">V{row.n}</span>
                        </span>
                      </td>
                      <td className="num mono">{formatLapTime(row.lap.lapTime)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector1 ?? null)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector2 ?? null)}</td>
                      <td className="num mono">{formatLapTime(row.info?.sector3 ?? null)}</td>
                      <td className="num mono">{Math.max(...row.lap.speed)}</td>
                    </tr>
                  ))}
                  {lapB && (
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
                  )}
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
                {at.delta && (
                  <span>
                    Δ <b>{at.delta[i!] > 0 ? '+' : ''}{at.delta[i!].toFixed(2)} s</b>
                  </span>
                )}
                <span>
                  <i style={{ background: colorA }} /> {Math.round(at.a.speed[i!])} km/h · {at.a.gear[i!]}ª ·{' '}
                  {Math.round(at.a.throttle[i!])}%{at.a.brake[i!] ? ' · freio' : ''}
                  {at.a.drs[i!] ? ' · DRS' : ''}
                </span>
                {at.b && (
                  <span>
                    <i style={{ background: colorB }} /> {Math.round(at.b.speed[i!])} km/h · {at.b.gear[i!]}ª ·{' '}
                    {Math.round(at.b.throttle[i!])}%{at.b.brake[i!] ? ' · freio' : ''}
                    {at.b.drs[i!] ? ' · DRS' : ''}
                  </span>
                )}
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
            {driverB
              ? 'Voltas alinhadas por distância a cada 5 m. A diferença é o tempo acumulado de B menos o de A no mesmo ponto da pista. Dados do carro a ~4 Hz.'
              : 'Canais da volta por distância, a cada 5 m. Dados do carro a ~4 Hz.'}
          </p>
        </>
      )}
    </Card>
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
  driver,
  lap,
  onDriver,
  onLap,
  laps,
  results,
  available,
  noneLabel,
}: {
  tag: string
  color: string
  driver: string | null
  lap: number | null
  onDriver: (d: string) => void
  onLap: (lap: number) => void
  laps: Lap[]
  results: DriverResult[]
  available: string[]
  /** Com isto, o seletor ganha a opção de não escolher piloto (valor vazio). */
  noneLabel?: string
}) {
  const drivers = [...results]
    .filter((r) => available.includes(r.driver))
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const mine = laps.filter((l) => l.driver === driver && l.lap != null)
  const timed = mine.filter((l) => l.lapTime != null)
  // sem nenhuma volta cronometrada (abandono na largada), lista as que existirem
  const driverLaps = (timed.length ? timed : mine).sort((a, b) => a.lap! - b.lap!)
  const best = fastestLap(driverLaps)

  return (
    <div className="lap-picker" style={{ borderColor: color }}>
      <span className="picker-tag" style={{ background: color, color: textOn(color) }}>
        {tag}
      </span>
      <select value={driver ?? ''} aria-label={`Piloto ${tag}`} onChange={(e) => onDriver(e.target.value)}>
        {noneLabel && <option value="">{noneLabel}</option>}
        {drivers.map((r) => (
          <option key={r.driver} value={r.driver}>
            {r.driver} · {r.fullName}
          </option>
        ))}
      </select>
      <select
        value={lap ?? ''}
        aria-label={`Volta ${tag}`}
        onChange={(e) => onLap(Number(e.target.value))}
        disabled={!driver}
        hidden={!driver}
      >
        {driverLaps.map((l) => (
          <option key={l.lap} value={l.lap!}>
            V{l.lap} · {formatLapTime(l.lapTime)} · {COMPOUND_LETTER[l.compound ?? ''] ?? '?'}
            {l.lap === best?.lap ? ' · mais rápida' : ''}
            {l.deleted ? ' · anulada' : ''}
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
