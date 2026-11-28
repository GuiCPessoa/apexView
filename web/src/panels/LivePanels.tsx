import { memo, useMemo, type ReactNode } from 'react'
import { formatLapTime } from '../lib/data'
import { winner } from '../lib/duel'
import { dimmed } from '../lib/focus'
import { formatLiveGap } from '../lib/live'
import { decimal, dominanceCount, dominanceSpans, segmentClass, windLabel } from '../lib/liveDisplay'
import type { Projection } from '../lib/replay'
import { COMPOUND } from '../lib/tyres'
import type { WeatherSample } from '../types/data'
import type { LiveDominance, LiveDriver, LiveSector, LiveSnapshot, LiveTimed } from '../types/live'

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

/** Bloco da grade: título com a barrinha vermelha, um canto à direita e o conteúdo. */
export function Box({
  title,
  aside,
  className = '',
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`lv-box ${className}`}>
      <header className="lv-hd">
        <h3>{title}</h3>
        {aside != null && <span className="lv-aside">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function Tyre({ compound }: { compound: string | null }) {
  const c = compound ? COMPOUND[compound] : null
  if (!c) return <span className="muted">—</span>
  return (
    <span className={`tyre ${c.className}`} title={c.label}>
      {c.letter}
    </span>
  )
}

const num = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits).replace('.', ','))

// ---------- B, C · pilotos em foco ----------

/** Barra de 0 a 1 (escala, não largura: muda sem refazer o layout; o CSS anima entre snapshots). */
function Meter({ k, className, color }: { k: number; className: string; color?: string }) {
  return (
    <span className="pedal-track">
      <span className={`pedal-fill ${className}`} style={{ transform: `scaleX(${Math.max(0, Math.min(1, k))})`, background: color }} />
    </span>
  )
}

/**
 * Cartão de um piloto em foco, na cor dele: nome, posição, motor e pedais ao vivo e os números
 * da volta (diferenças, última e melhor, pneu, máxima na reta).
 */
export function DriverCard({ d, slot, color }: { d: LiveDriver | null; slot: 'A' | 'B'; color: string }) {
  const area = slot === 'A' ? 'lv-drv-a' : 'lv-drv-b'
  if (!d) {
    return (
      <Box title={`Piloto ${slot}`} className={`lv-drv ${area}`}>
        <p className="muted">Clique num piloto na torre ou no mapa.</p>
      </Box>
    )
  }
  const out = d.retired || d.stopped
  const leader = d.position === 1
  const last = (d.fullName ?? d.driver).split(' ').slice(-1)[0]
  return (
    <section className={`lv-box lv-drv ${area}`} style={{ borderTopColor: color }}>
      <div className="drv-top">
        <div className="drv-id">
          <div className="drv-name" style={{ color }}>
            {last}
          </div>
          <div className="drv-team">
            #{d.number} · {d.team}
            {d.inPit && <span className="pit-badge">BOX</span>}
            {d.pitOut && !d.inPit && <span className="pit-badge out">SAÍDA</span>}
          </div>
        </div>
        <div className="drv-pos">
          <span className="drv-slot" style={{ background: color }}>
            {slot}
          </span>
          {out ? <span className="drv-out">{d.retired ? 'Abandono' : 'Parado'}</span> : `P${d.position ?? '—'}`}
        </div>
      </div>
      <div className="drv-live">
        <div className="drv-speed">
          <b>{d.speed ?? '—'}</b>
          <small>km/h · marcha {d.gear == null ? '—' : d.gear === 0 ? 'N' : d.gear}</small>
        </div>
        <div className="drv-meters">
          <span>RPM</span>
          <Meter k={(d.rpm ?? 0) / 13000} className="rpm" color={color} />
          <span>Acel.</span>
          <Meter k={(d.throttle ?? 0) / 100} className="throttle" />
          <span>Freio</span>
          <Meter k={d.brake ? 1 : 0} className="brake" />
        </div>
        <span className={`drs-chip ${d.drs ? 'on' : ''}`}>DRS</span>
      </div>
      <div className="drv-kv">
        <div>
          <span className="lbl">Líder</span>
          <b className="mono">{leader || out ? '—' : decimal(formatLiveGap(d.gap))}</b>
        </div>
        <div>
          <span className="lbl">Int.</span>
          <b className="mono">{leader || out ? '—' : decimal(formatLiveGap(d.interval))}</b>
        </div>
        <div>
          <span className="lbl">Pneu</span>
          <b>
            <Tyre compound={d.compound} /> <span className="mono">{d.tyreAge ?? ''}</span>
            <small className="muted"> · {d.pits ?? 0}p</small>
          </b>
        </div>
        <div>
          <span className="lbl">Última</span>
          <b>
            <Timed t={d.lastLap} />
          </b>
        </div>
        <div>
          <span className="lbl">Melhor</span>
          <b>
            <Timed t={d.bestLap} />
          </b>
        </div>
        <div>
          <span className="lbl">Reta</span>
          <b className={`mono ${bestClass(d.topSpeed?.best)}`}>{d.topSpeed ? d.topSpeed.value : '—'}</b>
        </div>
      </div>
    </section>
  )
}

// ---------- D · torre ----------

/** Tudo o que a linha mostra: se não mudou, a linha não é redesenhada. */
function rowKey(d: LiveDriver): string {
  const t = (x: LiveTimed | null) => (x ? `${x.time}${x.best ?? ''}` : '')
  const s = d.sectors.map((x) => (x ? `${x.time}${x.best ?? ''}${x.segments.join('')}` : '')).join('|')
  return [
    d.position, d.team, d.teamColor, d.gap, d.interval, t(d.lastLap), s, d.inPit, d.pitOut,
    d.retired, d.stopped, d.knockedOut, d.compound, d.tyreAge,
  ].join(';')
}

const TowerRow = memo(
  function TowerRow({ d, slot, dim, onToggle }: { d: LiveDriver; slot: 'A' | 'B' | null; dim: boolean; onToggle: (d: string) => void }) {
    const out = d.retired || d.stopped
    const leader = d.position === 1
    const close = !leader && !out && /^\+?0\.\d+$/.test(d.interval ?? '')
    const color = d.teamColor ?? '#888'
    return (
      <tr className={`${slot ? 'focused' : ''} ${dim ? 'dim' : ''} ${out || d.knockedOut ? 'out' : ''}`} onClick={() => onToggle(d.driver)}>
        <td className="t-pos">{out ? '—' : (d.position ?? '')}</td>
        <td className="t-drv">
          <i style={{ background: color }} />
          {d.driver}
          {slot && (
            <span className="t-slot" style={{ background: color }}>
              {slot}
            </span>
          )}
          {d.inPit && <span className="pit-badge">BOX</span>}
          {d.pitOut && !d.inPit && <span className="pit-badge out">SAÍDA</span>}
        </td>
        <td className="t-gap mono">
          {close && <span className="t-drs">DRS</span>}
          {leader || out ? '' : decimal(formatLiveGap(d.interval))}
        </td>
        <td className="t-gap mono">{out ? (d.retired ? 'Abandono' : 'Parado') : leader ? 'Líder' : decimal(formatLiveGap(d.gap))}</td>
        <td className="t-lap">{!out && <Timed t={d.lastLap} />}</td>
        <td className="t-secs">
          {[0, 1, 2].map((i) => (
            <Segments key={i} s={d.sectors[i] ?? null} />
          ))}
        </td>
        <td className="t-tyre">
          {!out && d.compound && (
            <>
              <Tyre compound={d.compound} /> <span className="muted">{d.tyreAge ?? ''}</span>
            </>
          )}
        </td>
      </tr>
    )
  },
  (a, b) => a.slot === b.slot && a.dim === b.dim && a.onToggle === b.onToggle && rowKey(a.d) === rowKey(b.d),
)

/** Torre de tempos compacta: cabem os 22 pilotos na coluna da direita sem rolar. */
export function LiveTower({
  drivers,
  focus,
  pair,
  onToggle,
}: {
  drivers: LiveDriver[]
  focus: string[]
  pair: [string | null, string | null]
  onToggle: (d: string) => void
}) {
  return (
    <div className="lv-scroll">
      <table className="lv-tower">
        <thead>
          <tr>
            <th className="t-pos">P</th>
            <th className="t-drv">Piloto</th>
            <th className="t-gap">Int.</th>
            <th className="t-gap">Líder</th>
            <th className="t-lap">Última</th>
            <th className="t-secs">Setores</th>
            <th className="t-tyre">Pneu</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <TowerRow
              key={d.driver}
              d={d}
              slot={d.driver === pair[0] ? 'A' : d.driver === pair[1] ? 'B' : null}
              dim={dimmed(focus, d.driver)}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- F · duelo ----------

const SPARK_W = 240
const SPARK_H = 64

/** Diferença entre os dois pilotos nas últimas voltas (B atrás de A = positivo). */
function DuelSpark({ series, color }: { series: [number, number][]; color: string }) {
  if (series.length < 2) return <p className="muted lv-note">A tendência aparece depois de duas voltas dos dois.</p>
  const vals = series.map((p) => p[1])
  const lo = Math.min(0, ...vals)
  const hi = Math.max(1.2, ...vals)
  const x = (i: number) => 4 + (i * (SPARK_W - 8)) / (series.length - 1)
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (SPARK_H - 16)
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const drs = hi >= 1 && lo <= 1 ? y(1) : null
  return (
    <svg className="duel-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
      {drs != null && <line x1="0" x2={SPARK_W} y1={drs} y2={drs} className="duel-drs" />}
      {lo < 0 && <line x1="0" x2={SPARK_W} y1={y(0)} y2={y(0)} className="duel-zero" />}
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const sec = (s: LiveSector | null | undefined) => s?.time ?? s?.previous ?? null

/** Novo: os dois pilotos em foco lado a lado: diferença, tendência e quem vence em cada parte da volta. */
export function DuelBox({
  a,
  b,
  colors,
  gap,
  series,
  isRace,
}: {
  a: LiveDriver | null
  b: LiveDriver | null
  colors: [string, string]
  gap: number | null
  series: [number, number][]
  isRace: boolean
}) {
  if (!a || !b) {
    return (
      <Box title="Duelo" className="lv-duel">
        <p className="muted">Escolha dois pilotos para comparar.</p>
      </Box>
    )
  }
  const [ca, cb] = colors
  const trend = series.length >= 2 ? series[series.length - 1][1] - series[0][1] : null
  const ahead = gap == null ? null : gap >= 0 ? a : b
  const row = (k: string, va: number | null | undefined, vb: number | null | undefined, fmt: (v: number) => string, higher = false) => {
    const w = winner(va, vb, higher)
    return (
      <tr key={k}>
        <td className={w === 'a' ? 'win' : 'muted'} style={w === 'a' ? { color: ca } : undefined}>
          {va == null ? '—' : fmt(va)}
        </td>
        <td className="k">{k}</td>
        <td className={w === 'b' ? 'win' : 'muted'} style={w === 'b' ? { color: cb } : undefined}>
          {vb == null ? '—' : fmt(vb)}
        </td>
      </tr>
    )
  }
  const s3 = (v: number) => v.toFixed(3)
  return (
    <Box title="Duelo" className="lv-duel" aside={isRace ? 'na pista' : 'na melhor volta'}>
      <div className="duel-vs">
        <span style={{ color: ca }}>
          {a.driver} <em>P{a.position ?? '—'}</em>
        </span>
        <em>×</em>
        <span style={{ color: cb }}>
          <em>P{b.position ?? '—'}</em> {b.driver}
        </span>
      </div>
      <div className="duel-gap mono">
        {gap == null ? '—' : s3(Math.abs(gap))}
        <small> s</small>
      </div>
      <div className="duel-sub">
        {gap == null ? (
          'sem diferença em tempo (volta de atraso ou sem volta)'
        ) : (
          <>
            <b style={{ color: ahead === a ? ca : cb }}>{ahead?.driver}</b> na frente
            {isRace && trend != null && Math.abs(trend) >= 0.05 && (
              <>
                {' · '}
                <span className={trend < 0 ? 'up' : 'down'}>
                  {trend < 0 ? '▼' : '▲'} {s3(Math.abs(trend))} s em {series.length - 1} {series.length - 1 === 1 ? 'volta' : 'voltas'}
                </span>
              </>
            )}
          </>
        )}
      </div>
      {isRace && <DuelSpark series={series} color={cb} />}
      <table className="duel-table">
        <tbody>
          {row('Última', a.lastLap?.time, b.lastLap?.time, formatLapTime)}
          {!isRace && row('Melhor', a.bestLap?.time, b.bestLap?.time, formatLapTime)}
          {row('S1', sec(a.sectors[0]), sec(b.sectors[0]), s3)}
          {row('S2', sec(a.sectors[1]), sec(b.sectors[1]), s3)}
          {row('S3', sec(a.sectors[2]), sec(b.sectors[2]), s3)}
          {row('Reta', a.topSpeed?.value, b.topSpeed?.value, String, true)}
          <tr>
            <td>
              <Tyre compound={a.compound} /> {a.tyreAge ?? ''}
            </td>
            <td className="k">Pneu</td>
            <td>
              {b.tyreAge ?? ''} <Tyre compound={b.compound} />
            </td>
          </tr>
        </tbody>
      </table>
    </Box>
  )
}

// ---------- G · clima ----------

const WX_W = 260
const WX_H = 48

/** Clima atual e a curva da temperatura da pista na sessão. Só redesenha quando algo muda. */
export const WeatherBox = memo(function WeatherBox({ w, history }: { w: LiveSnapshot['weather']; history: WeatherSample[] }) {
  const line = useMemo(() => {
    const pts = history.filter((p) => p.trackTemp != null)
    if (pts.length < 2) return null
    const t0 = pts[0].time
    const t1 = pts[pts.length - 1].time
    const vals = pts.map((p) => p.trackTemp!)
    const lo = Math.min(...vals) - 0.3
    const hi = Math.max(...vals) + 0.3
    return pts
      .map((p, i) => `${i ? 'L' : 'M'}${(((p.time - t0) / (t1 - t0 || 1)) * WX_W).toFixed(1)},${(WX_H - 3 - ((p.trackTemp! - lo) / (hi - lo)) * (WX_H - 8)).toFixed(1)}`)
      .join('')
  }, [history])
  return (
    <Box title="Clima" className="lv-wx" aside={w ? (w.rainfall ? 'chovendo' : 'sem chuva') : undefined}>
      {!w ? (
        <p className="muted">Sem dados de clima ainda.</p>
      ) : (
        <>
          <div className="wx-2">
            <div>
              <span className="lbl">Pista</span>
              <b>
                {num(w.trackTemp)}
                <span>°C</span>
              </b>
            </div>
            <div>
              <span className="lbl">Ar</span>
              <b>
                {num(w.airTemp)}
                <span>°C</span>
              </b>
            </div>
            <div>
              <span className="lbl">Umidade</span>
              <b>
                {num(w.humidity, 0)}
                <span>%</span>
              </b>
            </div>
            <div>
              <span className="lbl">Vento</span>
              <b>
                {w.windSpeed == null ? '—' : Math.round(w.windSpeed * 3.6)}
                <span>km/h{w.windDirection != null ? ` ${windLabel(w.windDirection)}` : ''}</span>
              </b>
            </div>
          </div>
          {line && (
            <div className="wx-curve">
              <span className="lbl">Temperatura da pista na sessão</span>
              <svg viewBox={`0 0 ${WX_W} ${WX_H}`} preserveAspectRatio="none" aria-hidden="true">
                <path d={line} fill="none" stroke="#f59e0b" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}
        </>
      )}
    </Box>
  )
})

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
        {ranking.length > 6 && <span className="muted lv-note">+ {ranking.length - 6} pilotos com menos mini setores</span>}
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
