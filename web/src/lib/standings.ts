import type { Calendar, CalendarRound, Standings } from '../types/data'

// Máximo de pontos por fim de semana (sem ponto extra de volta mais rápida, desde 2025)
const RACE = { driver: 25, team: 25 + 18 }
const SPRINT = { driver: 8, team: 8 + 7 }

export interface TitleRace {
  remaining: CalendarRound[]
  finished: boolean
  /** Pontos ainda em disputa para um piloto e para uma equipe. */
  maxDriver: number
  maxTeam: number
  driverLead: number
  teamLead: number
  /** O líder já não pode mais ser alcançado. */
  driverDecided: boolean
  teamDecided: boolean
}

/** Situação da briga pelo título após a última rodada da classificação. */
export function titleRace(s: Standings, c: Calendar): TitleRace {
  const remaining = c.rounds.filter((r) => r.round > s.afterRound)
  const finished = remaining.length === 0
  const maxDriver = remaining.reduce((a, r) => a + RACE.driver + (r.sprint ? SPRINT.driver : 0), 0)
  const maxTeam = remaining.reduce((a, r) => a + RACE.team + (r.sprint ? SPRINT.team : 0), 0)
  const [d1, d2] = s.drivers
  const [c1, c2] = s.constructors
  const driverLead = d1 ? d1.points - (d2?.points ?? 0) : 0
  const teamLead = c1 ? c1.points - (c2?.points ?? 0) : 0
  return {
    remaining,
    finished,
    maxDriver,
    maxTeam,
    driverLead,
    teamLead,
    driverDecided: d1 != null && (finished || driverLead > maxDriver),
    teamDecided: c1 != null && (finished || teamLead > maxTeam),
  }
}

/** Data da corrida de uma rodada (a sessão "R" do calendário). */
export function raceStart(r: CalendarRound): Date | null {
  const start = r.sessions.find((x) => x.code === 'R')?.start
  return start ? new Date(start) : null
}

/** "hoje", "amanhã", "em 11 dias". */
export function daysUntil(date: Date, now: Date): string {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((day(date) - day(now)) / 864e5)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'amanhã'
  return `em ${days} dias`
}

/** Afasta rótulos verticais (px) para não se sobreporem, mantendo a ordem de entrada. */
export function spreadLabels(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap)
  const out = new Array<number>(ys.length)
  for (const o of order) out[o.i] = o.y
  return out
}

/**
 * Cor de cada linha: a da equipe; se já usada por um piloto mais bem colocado (companheiro),
 * vira branco e depois cinza.
 */
export function lineColors(drivers: { driver: string; teamColor: string | null }[]): Record<string, string> {
  const fallbacks = ['#ececf0', '#8b8b96']
  const used = new Set<string>()
  const out: Record<string, string> = {}
  for (const d of drivers) {
    let color = (d.teamColor ?? '#8b8b96').toLowerCase()
    for (let k = 0; used.has(color) && k < fallbacks.length; k++) color = fallbacks[k]
    used.add(color)
    out[d.driver] = color
  }
  return out
}
