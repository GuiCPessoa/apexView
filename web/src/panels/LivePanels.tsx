import { memo, useMemo } from 'react'
import { formatLapTime } from '../lib/data'
import { dimmed } from '../lib/focus'
import { formatLiveGap } from '../lib/live'
import { decimal, dominanceCount, dominanceSpans, segmentClass, teamCode, windLabel } from '../lib/liveDisplay'
import type { Projection } from '../lib/replay'
import { textOn } from '../lib/telemetry'
import { COMPOUND } from '../lib/tyres'
import type { LiveDominance, LiveDriver, LiveSector, LiveSnapshot, LiveSpeedTrap, LiveTimed } from '../types/live'

const bestClass = (best: 'overall' | 'personal' | null | undefined) => (best === 'overall' ? 'fastest' : best === 'personal' ? 'personal' : '')

function Timed({ t }: { t: LiveTimed | null | undefined }) {
  if (!t) return <span className="mono muted">—</span>
  return <span className={`mono ${bestClass(t.best)}`}>{formatLapTime(t.time)}</span>
}

/** Mini setores de um setor (barrinhas coloridas). */
function Segments({ s }: { s: LiveSector | null }) {
  return (
    <span className="segs" aria-hidden="true">
      {(s?.segments ?? []).map((g, i) => (
        <i key={i} className={segmentClass(g)} />
      ))}
    </span>
  )
}

/** Tempo do setor nesta volta; sem tempo ainda, o da volta anterior em cinza. */
function SectorTime({ s, withPrevious }: { s: LiveSector | null; withPrevious?: boolean }) {
  if (!s) return <span className="mono muted">—</span>
  return (
    <span className="sec-time">
      {s.time != null ? (
        <span className={`mono ${bestClass(s.best) || 'not-best'}`}>{s.time.toFixed(3)}</span>
      ) : (
        <span className="mono muted">—</span>
      )}
      {withPrevious && s.previous != null && <small className="mono">{s.previous.toFixed(3)}</small>}
    </span>
  )
}

// ---------- Clima ----------

const ICONS = {
  air: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
      <path d="M14 14V4a2 2 0 0 0-4 0v10a4 4 0 1 0 4 0z" />
    </svg>
  ),
  track: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round">
      <path d="M14 14V4a2 2 0 0 0-4 0v10a4 4 0 1 0 4 0z" />
    </svg>
  ),
  humidity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </svg>
  ),
  pressure: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4-5" />
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" strokeWidth="2" strokeLinecap="round">
      <path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 17 15z" />
      <path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
    </svg>
  ),
}

const num = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits).replace('.', ','))

/** Clima atual em 6 blocos pequenos. Só redesenha quando algum valor muda. */
export const WeatherBlocks = memo(
  function WeatherBlocks({ w }: { w: LiveSnapshot['weather'] }) {
    const item = (icon: React.ReactNode, label: string, value: string, unit: string) => (
      <div className="wx-item">
        {icon}
        <div>
          <small>{label}</small>
          <b>
            {value}
            {unit && <span>{unit}</span>}
          </b>
        </div>
      </div>
    )
    // seta para onde o vento vai (o feed dá de onde ele vem)
    const wind = (
      <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinejoin="round" style={{ transform: `rotate(${((w?.windDirection ?? 0) + 180) % 360}deg)` }}>
        <path d="M12 3l5 16-5-4-5 4z" />
      </svg>
    )
    return (
      <div className="pw-blk">
        <span className="pw-label">Clima</span>
        {!w ? (
          <p className="muted">Sem dados de clima ainda.</p>
        ) : (
          <div className="wx-grid">
            {item(ICONS.air, 'Ar', num(w.airTemp), '°C')}
            {item(ICONS.track, 'Pista', num(w.trackTemp), '°C')}
            {item(ICONS.humidity, 'Umidade', num(w.humidity), '%')}
            {item(wind, 'Vento', num(w.windSpeed), w.windDirection != null ? `m/s · ${windLabel(w.windDirection)}` : 'm/s')}
            {item(ICONS.pressure, 'Pressão', num(w.pressure), 'hPa')}
            {item(ICONS.rain, 'Chuva', w.rainfall ? 'Sim' : 'Não', '')}
          </div>
        )}
      </div>
    )
  },
  (a, b) => JSON.stringify(a.w) === JSON.stringify(b.w),
)

// ---------- Coluna do piloto ----------

function RpmGauge({ rpm, gear, color }: { rpm: number | null; gear: number | null; color: string }) {
  const k = Math.max(0, Math.min(1, (rpm ?? 0) / 13000))
  const R = 38
  const cx = 46
  const cy = 48
  const at = (a: number) => `${(cx + R * Math.cos(a)).toFixed(1)},${(cy - R * Math.sin(a)).toFixed(1)}`
  const arc = `M ${at(Math.PI)} A ${R} ${R} 0 0 1 ${at(0)}`
  return (
    <svg viewBox="0 0 92 56" className="rpm-gauge" aria-hidden="true">
      <path d={arc} className="rpm-track" />
      {/* arco fixo, preenchido pelo traço: o CSS anima o valor entre um snapshot e o seguinte */}
      <path d={arc} pathLength={1} className="rpm-fill" style={{ stroke: color, strokeDashoffset: 1 - k, opacity: k > 0 ? 1 : 0 }} />
      <text x={cx} y={cy - 2}>
        {gear == null ? '—' : gear === 0 ? 'N' : gear}
      </text>
    </svg>
  )
}

function SpeedTrap({ t }: { t: LiveSpeedTrap | null | undefined }) {
  if (!t) return <span className="pw-mid muted">—</span>
  return (
    <span className={`pw-mid ${bestClass(t.best)}`}>
      {t.value}
      <small> km/h</small>
    </span>
  )
}

/**
 * Coluna de um piloto em foco: nome, posição e diferenças, voltas, setores, velocidade, motor,
 * pedais e pneu, cada um num bloco.
 */
export function DriverColumn({ d, slot, color, right }: { d: LiveDriver | null; slot: 'A' | 'B'; color: string; right?: boolean }) {
  if (!d) {
    return (
      <div className="pw-col">
        <div className="pw-blk">
          <span className="pw-label">Piloto {slot}</span>
          <p className="muted">Clique num piloto na torre ou no mapa.</p>
        </div>
      </div>
    )
  }
  const out = d.retired || d.stopped
  const leader = d.position === 1
  const c = d.compound ? COMPOUND[d.compound] : null
  const [first, ...rest] = (d.fullName ?? d.driver).split(' ')
  return (
    <div className={`pw-col ${right ? 'right' : ''}`}>
      <div className="pw-blk pw-head" style={{ borderTopColor: color }}>
        <span className="pw-label">Piloto {slot}</span>
        <div className="pw-name" style={{ color }}>
          {first} {rest.join(' ')}
        </div>
        <div className="pw-sub">
          <span className="pw-num" style={{ background: d.teamColor ?? '#888', color: textOn(d.teamColor ?? '#888888') }}>
            {d.number}
          </span>
          {d.team}
          {d.inPit && <span className="pit-badge">BOX</span>}
          {d.pitOut && !d.inPit && <span className="pit-badge out">SAÍDA</span>}
        </div>
      </div>
      <div className="pw-pair">
        <div className="pw-blk">
          <span className="pw-label">Posição</span>
          <div className="pw-big">{d.position ?? '—'}</div>
        </div>
        <div className="pw-blk">
          <span className="pw-label">{leader ? 'Líder' : 'Para o líder'}</span>
          <div className="pw-mid mono">{out ? (d.retired ? 'Abandono' : 'Parado') : leader ? '—' : decimal(formatLiveGap(d.gap))}</div>
          <span className="pw-label pw-label-gap">Intervalo</span>
          <div className="mono muted">{leader ? '—' : decimal(formatLiveGap(d.interval))}</div>
        </div>
      </div>
      <div className="pw-blk">
        <span className="pw-label">{d.laps != null ? `Volta ${d.laps + 1}` : 'Volta'}</span>
        <div className="pw-laps">
          <span className="pw-label">Última</span>
          <span className="pw-label">Melhor</span>
          <b>
            <Timed t={d.lastLap} />
          </b>
          <b>
            <Timed t={d.bestLap} />
          </b>
        </div>
      </div>
      <div className="pw-blk">
        <span className="pw-label">Setores</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="pw-sector">
            <span className="muted">S{i + 1}</span>
            <Segments s={d.sectors[i] ?? null} />
            <SectorTime s={d.sectors[i] ?? null} />
          </div>
        ))}
      </div>
      <div className="pw-pair">
        <div className="pw-blk">
          <span className="pw-label">Velocidade</span>
          <span className="pw-mid">
            {d.speed ?? '—'}
            <small> km/h</small>
          </span>
        </div>
        <div className="pw-blk">
          <span className="pw-label">Máx. na reta</span>
          <SpeedTrap t={d.topSpeed} />
        </div>
      </div>
      <div className="pw-blk">
        <span className="pw-label">Motor</span>
        <div className="pw-gauge">
          <RpmGauge rpm={d.rpm} gear={d.gear} color={color} />
          <div>
            <div className="pw-mid">{d.rpm != null ? d.rpm.toLocaleString('pt-BR') : '—'}</div>
            <span className="muted pw-small">RPM · marcha {d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</span>
          </div>
        </div>
      </div>
      <div className="pw-blk">
        <div className="pw-blk-head">
          <span className="pw-label">Pedais</span>
          <span className={`drs-chip ${d.drs ? 'on' : ''}`}>DRS</span>
        </div>
        <div className="pedal">
          Acelerador
          <span className="pedal-track">
            {/* escala, não largura: muda sem refazer o layout da página */}
            <span className="pedal-fill throttle" style={{ transform: `scaleX(${Math.max(0, Math.min(1, (d.throttle ?? 0) / 100))})` }} />
          </span>
          <b>{d.throttle != null ? `${d.throttle}%` : '—'}</b>
        </div>
        <div className="pedal">
          Freio
          <span className="pedal-track">
            <span className="pedal-fill brake" style={{ transform: `scaleX(${d.brake ? 1 : 0})` }} />
          </span>
          <b>{d.brake ? 'sim' : 'não'}</b>
        </div>
      </div>
      <div className="pw-blk">
        <span className="pw-label">Pneu</span>
        <div className="pw-tyre">
          <span className={`tyre-ring ${c?.className ?? ''}`}>{c?.letter ?? '?'}</span>
          <div>
            <div className="pw-mid">{d.tyreAge != null ? `${d.tyreAge} ${d.tyreAge === 1 ? 'volta' : 'voltas'}` : '—'}</div>
            <span className="muted pw-small">
              {c?.label.toLowerCase() ?? 'composto desconhecido'}
              {d.pits != null ? ` · ${d.pits} ${d.pits === 1 ? 'parada' : 'paradas'}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Torre ----------

/** Tudo o que a linha mostra: se não mudou, a linha não é redesenhada. */
function rowKey(d: LiveDriver): string {
  const t = (x: LiveTimed | null) => (x ? `${x.time}${x.best ?? ''}` : '')
  const s = d.sectors.map((x) => (x ? `${x.time}${x.best ?? ''}${x.previous}${x.segments.join('')}` : '')).join('|')
  return [
    d.position, d.team, d.teamColor, d.gap, d.interval, t(d.lastLap), t(d.bestLap), s, d.inPit, d.pitOut,
    d.retired, d.stopped, d.knockedOut, d.compound, d.tyreAge,
  ].join(';')
}

const TowerRow = memo(
  function TowerRow({ d, focused, dim, onToggle }: { d: LiveDriver; focused: boolean; dim: boolean; onToggle: (d: string) => void }) {
    const out = d.retired || d.stopped
    const c = d.compound ? COMPOUND[d.compound] : null
    const leader = d.position === 1
    return (
      <tr className={`${focused ? 'focused' : ''} ${dim ? 'dim' : ''} ${out || d.knockedOut ? 'out' : ''}`} onClick={() => onToggle(d.driver)}>
        <td className="lt-pos">{d.position ?? ''}</td>
        <td className="lt-team">
          <span className="team-chip" style={{ background: d.teamColor ?? '#888', color: textOn(d.teamColor ?? '#888888') }}>
            {teamCode(d.team)}
          </span>
        </td>
        <td className="lt-driver">
          {d.driver}
          {d.inPit && <span className="pit-badge">BOX</span>}
          {d.pitOut && !d.inPit && <span className="pit-badge out">SAÍDA</span>}
        </td>
        <td className="lt-gap mono">{out ? (d.retired ? 'Abandono' : 'Parado') : leader ? '—' : decimal(formatLiveGap(d.gap))}</td>
        <td className="lt-gap mono lt-int">{leader || out ? '—' : decimal(formatLiveGap(d.interval))}</td>
        <td className="lt-lap">
          <Timed t={d.lastLap} />
        </td>
        <td className="lt-lap lt-best">
          <Timed t={d.bestLap} />
        </td>
        {[0, 1, 2].map((i) => (
          <td key={i} className="lt-sec">
            <Segments s={d.sectors[i] ?? null} />
            <SectorTime s={d.sectors[i] ?? null} withPrevious />
          </td>
        ))}
        <td className="lt-tyre">
          {c && !out && (
            <span title={`${c.label}${d.tyreAge != null ? `, ${d.tyreAge} voltas` : ''}`}>
              <span className={`tyre ${c.className}`}>{c.letter}</span> <span className="muted">{d.tyreAge ?? ''}</span>
            </span>
          )}
        </td>
      </tr>
    )
  },
  (a, b) => a.focused === b.focused && a.dim === b.dim && a.onToggle === b.onToggle && rowKey(a.d) === rowKey(b.d),
)

/** Torre de tempos em largura total: diferenças, voltas, setores com mini setores e pneu. */
export function LiveTower({ drivers, focus, onToggle }: { drivers: LiveDriver[]; focus: string[]; onToggle: (d: string) => void }) {
  return (
    <div className="table-wrap live-tower-wrap">
      <table className="live-tower-table">
        <thead>
          <tr>
            <th className="lt-pos">Pos</th>
            <th className="lt-team" aria-label="Equipe" />
            <th className="lt-driver">Piloto</th>
            <th className="lt-gap">Líder</th>
            <th className="lt-gap lt-int">Intervalo</th>
            <th className="lt-lap">Última</th>
            <th className="lt-lap lt-best">Melhor</th>
            <th className="lt-sec">Setor 1</th>
            <th className="lt-sec">Setor 2</th>
            <th className="lt-sec">Setor 3</th>
            <th className="lt-tyre">Pneu</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <TowerRow key={d.driver} d={d} focused={focus.includes(d.driver)} dim={dimmed(focus, d.driver)} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Domínio da pista ----------

interface DominanceProps {
  outline: [number, number][]
  proj: Projection
  dominance: LiveDominance | null
  colors: Map<string, string>
}

/** Mapa com cada mini setor oficial na cor de quem tem o melhor tempo da sessão nele. */
export const DominanceMap = memo(function DominanceMap({ outline, proj, dominance, colors }: DominanceProps) {
  const pts = useMemo(() => outline.map(([x, y]) => proj.project(x, y)), [outline, proj])
  const spans = useMemo(() => (dominance ? dominanceSpans(outline, dominance) : []), [outline, dominance])
  const ranking = useMemo(() => (dominance ? dominanceCount(dominance) : []), [dominance])
  const n = pts.length
  const w = proj.size * 0.022
  const line = (from: number, to: number) => {
    const out: string[] = []
    for (let k = from; k <= to; k++) out.push(pts[k % n].map((v) => v.toFixed(1)).join(','))
    return out.join(' ')
  }
  const sectorEnds = dominance ? [dominance.sizes[0] - 1, dominance.sizes[0] + dominance.sizes[1] - 1] : []
  const total = dominance?.owners.length ?? 0

  if (!dominance || total === 0) {
    return <p className="muted loading">O domínio aparece quando o feed manda os mini setores (depois da primeira volta de alguém).</p>
  }
  return (
    <div className="dominance">
      <svg viewBox={proj.viewBox} className="track-map" role="img" aria-label="Domínio da pista por mini setor">
        <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="none" className="dom-casing" strokeWidth={w * 1.9} />
        {spans.map((s, i) => (
          <polyline
            key={i}
            points={line(s.from, s.to)}
            fill="none"
            stroke={s.owner ? (colors.get(s.owner) ?? '#8b8b97') : 'var(--tie, #5d5d68)'}
            strokeWidth={w}
            strokeLinejoin="round"
          >
            <title>{`Mini setor ${i + 1}: ${s.owner ?? 'ninguém ainda'}`}</title>
          </polyline>
        ))}
        {sectorEnds.map((g, j) => {
          const s = spans[g]
          if (!s) return null
          const [x, y] = pts[s.to % n]
          return (
            <g key={g} className="dom-sector">
              <circle cx={x} cy={y} r={w * 0.7} strokeWidth={w * 0.18} />
              <text x={x + w * 1.3} y={y + w * 0.5} fontSize={w * 1.4}>
                S{j + 2}
              </text>
            </g>
          )
        })}
        <rect x={pts[0][0] - w * 0.2} y={pts[0][1] - w} width={w * 0.4} height={w * 2} className="dom-finish" />
      </svg>
      <div className="dom-legend">
        {ranking.slice(0, 6).map((r) => (
          <div key={r.driver} className="dom-row">
            <span className="dom-bar" style={{ background: colors.get(r.driver) }} />
            <b>{r.driver}</b>
            <span className="dom-meter">
              <span style={{ width: `${(r.count / total) * 100}%`, background: colors.get(r.driver) }} />
            </span>
            <span className="mono muted">
              {r.count}/{total}
            </span>
          </div>
        ))}
        {ranking.length > 6 && <span className="muted pw-small">+ {ranking.length - 6} pilotos com menos mini setores</span>}
      </div>
      <div className="dom-strip" aria-hidden="true">
        {dominance.owners.map((o, i) => (
          <span
            key={i}
            className={i === dominance.sizes[0] || i === dominance.sizes[0] + dominance.sizes[1] ? 'gap-before' : undefined}
            style={{ background: o ? colors.get(o) : 'var(--tie, #5d5d68)' }}
            title={`Mini setor ${i + 1}: ${o ?? 'ninguém ainda'}`}
          />
        ))}
      </div>
      <div className="dom-sectors">
        <span>S1</span>
        <span>S2</span>
        <span>S3</span>
      </div>
    </div>
  )
})
