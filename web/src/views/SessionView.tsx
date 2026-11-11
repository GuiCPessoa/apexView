import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Card from '../components/Card'
import SessionPicker from '../components/SessionPicker'
import { formatGap, formatLapTime, loadLaps, loadMeta, loadResults } from '../lib/data'
import { toggleFocus } from '../lib/focus'
import { neutralizedLaps, pitStops, raceDrivers, totalLaps } from '../lib/race'
import { useAsync, type SessionTab } from '../lib/route'
import { SESSION_LABEL, rankingByBestLap } from '../lib/session'
import { fastestLap } from '../lib/telemetry'
import { EvolutionChart, SectorsTable } from '../panels/QualiPanels'
import { GapsChart, PitTable, PositionsChart, RaceResults, Strategy } from '../panels/RacePanels'
import ReplayPanel from '../panels/ReplayPanel'
import { PracticeResults, QualifyingResults } from '../panels/ResultsPanels'
import TelemetryPanel from '../panels/TelemetryPanel'
import type { DataIndex, DriverResult, Lap, SessionIndexEntry, SessionMeta } from '../types/data'

// links antigos (#/sessao/.../telemetria etc.) rolam até o cartão correspondente
const TAB_ANCHOR: Partial<Record<SessionTab, string>> = {
  race: 'positions',
  laps: 'sectors',
  replay: 'replay',
  telemetry: 'telemetry',
}

export default function SessionView({ path, tab, index }: { path: string | null; tab: SessionTab; index: DataIndex }) {
  const sessions = index.sessions
  const current = path ?? defaultSession(sessions)?.path ?? null
  const entry = sessions.find((s) => s.path === current) ?? null
  const known = entry != null

  const { data, error } = useAsync(
    current && known ? () => Promise.all([loadMeta(current), loadResults(current), loadLaps(current)]) : null,
    [current, known],
  )
  const [meta, results, laps] = data ?? [null, null, null]

  if (sessions.length === 0) {
    return (
      <p className="notice">
        Nenhuma sessão exportada ainda. Rode <code>python export_session.py 2024 Monza R</code> em <code>pipeline/</code>.
      </p>
    )
  }

  return (
    <section className="session">
      {entry && <SessionPicker index={index} current={entry} />}
      {!known && <p className="notice">Sessão {current} não exportada.</p>}
      {error && <p className="notice error">{error}</p>}
      {known && !data && !error && <p className="notice">Carregando…</p>}
      {meta && results && laps && current && (
        <Dashboard key={current} path={current} meta={meta} results={results} laps={laps} tab={tab} />
      )}
    </section>
  )
}

/** Sessão padrão: a corrida da rodada mais recente exportada (ou qualquer sessão dela). */
function defaultSession(sessions: SessionIndexEntry[]): SessionIndexEntry | undefined {
  if (sessions.length === 0) return undefined
  const latest = sessions.reduce((a, b) => (b.year > a.year || (b.year === a.year && b.round > a.round) ? b : a))
  const sameRound = sessions.filter((s) => s.year === latest.year && s.round === latest.round)
  return sameRound.find((s) => s.session === 'R') ?? sameRound[0]
}

interface DashboardProps {
  path: string
  meta: SessionMeta
  results: DriverResult[]
  laps: Lap[]
  tab: SessionTab
}

/** Painel único da sessão: todos os cartões compartilham os pilotos em foco e a volta do replay. */
function Dashboard({ path, meta, results, laps, tab }: DashboardProps) {
  const [focus, setFocus] = useState<string[]>([])
  const [cursorLap, setCursorLap] = useState<number | null>(null)
  const onToggle = useCallback((d: string) => setFocus((f) => toggleFocus(f, d)), [])

  const isRace = meta.session === 'R' || meta.session === 'S'
  const isQuali = meta.session === 'Q' || meta.session === 'SQ'

  useEffect(() => {
    const anchor = TAB_ANCHOR[tab]
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
  }, [tab])

  return (
    <>
      <Hero meta={meta} results={results} laps={laps} />
      <FocusBar focus={focus} results={results} onToggle={onToggle} onClear={() => setFocus([])} />
      <div className="dash">
        {isRace ? (
          <RaceCards
            path={path}
            meta={meta}
            results={results}
            laps={laps}
            focus={focus}
            onToggle={onToggle}
            setFocus={setFocus}
            cursorLap={cursorLap}
            onLap={setCursorLap}
          />
        ) : (
          <>
            <TelemetryPanel path={path} meta={meta} results={results} laps={laps} focus={focus} onFocusChange={setFocus} span={8} />
            <Card title="Resultado" span={4} className="results-card">
              {isQuali ? (
                <QualifyingResults meta={meta} results={results} focus={focus} onToggle={onToggle} />
              ) : (
                <PracticeResults results={results} laps={laps} focus={focus} onToggle={onToggle} />
              )}
            </Card>
            <Card title="Melhores voltas e setores" span={12} id="sectors">
              <SectorsTable results={results} laps={laps} focus={focus} onToggle={onToggle} />
            </Card>
            <Card title="Evolução da sessão" span={12}>
              <EvolutionChart meta={meta} results={results} laps={laps} focus={focus} />
            </Card>
          </>
        )}
      </div>
      <p className="foot">
        Dados: FastF1 {meta.fastf1Version} · gerado em {new Date(meta.generatedAt).toLocaleString('pt-BR')}
      </p>
    </>
  )
}

function RaceCards({
  path,
  meta,
  results,
  laps,
  focus,
  onToggle,
  setFocus,
  cursorLap,
  onLap,
}: Omit<DashboardProps, 'tab'> & {
  focus: string[]
  onToggle: (d: string) => void
  setFocus: (f: string[]) => void
  cursorLap: number | null
  onLap: (lap: number | null) => void
}) {
  const drivers = useMemo(() => raceDrivers(results), [results])
  const n = useMemo(() => totalLaps(laps), [laps])
  const bands = useMemo(() => neutralizedLaps(laps), [laps])
  const stops = useMemo(() => pitStops(laps, drivers.map((d) => d.driver)), [laps, drivers])
  const focusProps = { focus, onToggle }

  return (
    <>
      {meta.replay && <ReplayPanel path={path} meta={meta} results={results} laps={laps} onLap={onLap} {...focusProps} />}
      <TelemetryPanel path={path} meta={meta} results={results} laps={laps} focus={focus} onFocusChange={setFocus} span={8} />
      <Card title="Resultado" span={4} className="results-card" aside={<span className="muted">clique para focar</span>}>
        <RaceResults results={results} laps={laps} {...focusProps} />
      </Card>
      <Card title="Posições volta a volta" span={6} id="positions">
        <PositionsChart drivers={drivers} results={results} laps={laps} n={n} bands={bands} cursorLap={cursorLap} {...focusProps} />
      </Card>
      <Card title="Estratégia de pneus" span={6}>
        <Strategy drivers={drivers} laps={laps} n={n} cursorLap={cursorLap} {...focusProps} />
      </Card>
      <Card title="Diferença para o líder" span={8}>
        <GapsChart drivers={drivers} laps={laps} n={n} bands={bands} focus={focus} cursorLap={cursorLap} />
      </Card>
      <Card title="Pit stops" span={4} aside={<span className="muted">{stops.filter((s) => s.pitLaneTime != null).length} paradas</span>}>
        <PitTable stops={stops} drivers={drivers} {...focusProps} />
      </Card>
      {bands.size > 0 && (
        <p className="foot span-12">
          Faixas amarelas nos gráficos: voltas com safety car (mais forte) ou VSC (mais fraca). Faixa vermelha: bandeira
          vermelha.
        </p>
      )}
    </>
  )
}

// ---------- Cabeçalho ----------

interface Stat {
  label: string
  value: ReactNode
  sub: ReactNode
}

const bar = (r: DriverResult | undefined) => (
  <span className="team-bar" style={{ background: r?.teamColor ?? 'var(--muted)' }} />
)

function raceStats(results: DriverResult[], laps: Lap[]): Stat[] {
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const winner = sorted[0]
  const fl = fastestLap(laps)
  const gained = results
    .filter((r) => r.position != null && r.gridPosition && /^\d+$/.test(r.classifiedPosition ?? ''))
    .map((r) => ({ r, delta: r.gridPosition! - r.position! }))
    .sort((a, b) => b.delta - a.delta)[0]
  const stops = pitStops(laps, results.map((r) => r.driver)).filter((s) => s.pitLaneTime != null)
  const quickest = [...stops].sort((a, b) => a.pitLaneTime! - b.pitLaneTime!)[0]

  const out: Stat[] = []
  if (winner) out.push({ label: 'Vencedor', value: <>{bar(winner)}{winner.driver}</>, sub: winner.team })
  if (fl)
    out.push({
      label: 'Volta mais rápida',
      value: <span className="fastest">{formatLapTime(fl.lapTime)}</span>,
      sub: <>{fl.driver} · volta {fl.lap}</>,
    })
  if (gained && gained.delta > 0)
    out.push({
      label: 'Maior recuperação',
      value: <>{bar(gained.r)}{gained.r.driver} <span className="up">+{gained.delta}</span></>,
      sub: `P${gained.r.gridPosition} → P${gained.r.position}`,
    })
  out.push({
    label: 'Pit stops',
    value: stops.length,
    sub: quickest ? `mais rápido: ${quickest.driver} ${quickest.pitLaneTime!.toFixed(1)} s` : '—',
  })
  return out
}

function qualiStats(results: DriverResult[], laps: Lap[]): Stat[] {
  const sorted = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  const time = (r: DriverResult | undefined) => (r ? (r.q3 ?? r.q2 ?? r.q1 ?? null) : null)
  const [pole, second] = sorted
  const ranking = rankingByBestLap(laps, results.map((r) => r.driver))
  const top = ranking.filter((r) => r.topSpeed != null).sort((a, b) => b.topSpeed! - a.topSpeed!)[0]
  const out: Stat[] = []
  if (pole) out.push({ label: 'Pole position', value: <>{bar(pole)}{pole.driver}</>, sub: formatLapTime(time(pole)) })
  if (second && time(second) != null && time(pole) != null)
    out.push({ label: '2º no grid', value: <>{bar(second)}{second.driver}</>, sub: formatGap(time(second)! - time(pole)!) })
  if (top)
    out.push({
      label: 'Velocidade máxima',
      value: `${top.topSpeed} km/h`,
      sub: top.driver,
    })
  out.push({ label: 'Voltas anuladas', value: laps.filter((l) => l.deleted).length, sub: 'limites de pista e outras' })
  return out
}

function practiceStats(results: DriverResult[], laps: Lap[]): Stat[] {
  const by = new Map(results.map((r) => [r.driver, r]))
  const ranking = rankingByBestLap(laps, results.map((r) => r.driver))
  const first = ranking[0]
  const most = [...ranking].sort((a, b) => b.laps - a.laps)[0]
  const out: Stat[] = []
  if (first?.best)
    out.push({ label: 'Mais rápido', value: <>{bar(by.get(first.driver))}{first.driver}</>, sub: formatLapTime(first.best.lapTime) })
  if (most) out.push({ label: 'Mais voltas', value: <>{bar(by.get(most.driver))}{most.driver}</>, sub: `${most.laps} voltas` })
  out.push({ label: 'Voltas cronometradas', value: laps.filter((l) => l.lapTime != null).length, sub: 'todos os pilotos' })
  return out
}

function Hero({ meta, results, laps }: { meta: SessionMeta; results: DriverResult[]; laps: Lap[] }) {
  const isRace = meta.session === 'R' || meta.session === 'S'
  const isQuali = meta.session === 'Q' || meta.session === 'SQ'
  const stats = isRace ? raceStats(results, laps) : isQuali ? qualiStats(results, laps) : practiceStats(results, laps)
  const lapCount = isRace ? totalLaps(laps) : 0
  return (
    <div className="hero">
      <div className="hero-title">
        <span className="kicker">
          Rodada {meta.round} · {SESSION_LABEL[meta.session] ?? meta.sessionName}
        </span>
        <h1>{meta.eventName}</h1>
        <p>
          {meta.location}, {meta.country}
          {meta.sessionDate && ` · ${new Date(meta.sessionDate).toLocaleDateString('pt-BR')}`}
          {lapCount > 0 && ` · ${lapCount} voltas`}
        </p>
      </div>
      <div className="hero-stats">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value}</span>
            <span className="stat-sub">{s.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Faixa com os pilotos em foco (aparece só quando há foco). */
function FocusBar({
  focus,
  results,
  onToggle,
  onClear,
}: {
  focus: string[]
  results: DriverResult[]
  onToggle: (d: string) => void
  onClear: () => void
}) {
  const by = new Map(results.map((r) => [r.driver, r]))
  return (
    <div className={`focus-bar ${focus.length ? 'on' : ''}`} aria-live="polite">
      {focus.length ? (
        <>
          <span className="muted">Em foco</span>
          {focus.map((d) => (
            <button key={d} className="chip on" onClick={() => onToggle(d)} title="Tirar do foco">
              <i style={{ background: by.get(d)?.teamColor ?? 'var(--muted)' }} />
              {d} ✕
            </button>
          ))}
          <button className="chip ghost" onClick={onClear}>
            Limpar
          </button>
        </>
      ) : (
        <span className="muted">
          Clique em um piloto (no mapa, na torre, no resultado ou nos gráficos) para destacá-lo em todo o painel. Dois
          pilotos em foco são comparados na telemetria.
        </span>
      )}
    </div>
  )
}
