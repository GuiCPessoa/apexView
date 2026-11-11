import type { CalendarRound, CalendarSession } from '../types/data'

const RACE_LENGTH_MS = 2 * 3600_000 // a rodada conta como disputada ~2 h depois da largada

/** Início da sessão; só a data ("2026-03-15") vira meio-dia UTC. */
export function sessionDate(start: string | null): Date | null {
  if (!start) return null
  return new Date(start.length === 10 ? `${start}T12:00:00Z` : start)
}

export function raceDate(r: CalendarRound): Date | null {
  return sessionDate(r.sessions.find((s) => s.code === 'R')?.start ?? null)
}

/** A corrida já terminou (estimativa: 2 h após a largada). Sem data, conta como futura. */
export function isDone(r: CalendarRound, now: Date): boolean {
  const race = raceDate(r)
  return race != null && race.getTime() + RACE_LENGTH_MS <= now.getTime()
}

/** Primeira sessão que ainda não começou, nas rodadas não disputadas. */
export function nextSession(rounds: CalendarRound[], now: Date): { round: CalendarRound; session: CalendarSession } | null {
  for (const round of rounds) {
    if (isDone(round, now)) continue
    for (const session of round.sessions) {
      const start = sessionDate(session.start)
      if (start && start > now) return { round, session }
    }
  }
  return null
}

const month = (d: Date) => d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')
const day = (d: Date) => String(d.getDate()).padStart(2, '0')

/** Datas do fim de semana: "05–08 mar" ou "30 out – 01 nov". */
export function weekendRange(r: CalendarRound): string {
  const dates = r.sessions.map((s) => sessionDate(s.start)).filter((d): d is Date => d != null)
  if (!dates.length) return 'a definir'
  const a = dates[0]
  const b = dates[dates.length - 1]
  if (a.getMonth() === b.getMonth()) return a.getDate() === b.getDate() ? `${day(a)} ${month(a)}` : `${day(a)}–${day(b)} ${month(b)}`
  return `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`
}

/** Sessões agrupadas pelo dia local ("quinta-feira, 19/11"). */
export function sessionsByDay(sessions: CalendarSession[]): { day: string; sessions: CalendarSession[] }[] {
  const out: { day: string; sessions: CalendarSession[] }[] = []
  for (const s of sessions) {
    const d = sessionDate(s.start)
    const label = d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }) : 'A definir'
    const last = out[out.length - 1]
    if (last?.day === label) last.sessions.push(s)
    else out.push({ day: label, sessions: [s] })
  }
  return out
}

export function countdown(target: Date, now: Date): { days: number; hours: number; minutes: number } {
  const ms = Math.max(0, target.getTime() - now.getTime())
  return { days: Math.floor(ms / 864e5), hours: Math.floor(ms / 36e5) % 24, minutes: Math.floor(ms / 6e4) % 60 }
}

/** Escala da linha do tempo: do 1º dia do mês da primeira corrida ao fim do mês da última. */
export function timelineScale(rounds: CalendarRound[]) {
  const dates = rounds.map(raceDate).filter((d): d is Date => d != null)
  if (!dates.length) return null
  const first = dates[0]
  const last = dates[dates.length - 1]
  const t0 = new Date(first.getFullYear(), first.getMonth(), 1).getTime()
  const t1 = new Date(last.getFullYear(), last.getMonth() + 1, 1).getTime()
  const months: { label: string; start: number; mid: number }[] = []
  for (const d = new Date(t0); d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
    months.push({ label: month(d), start: d.getTime(), mid: new Date(d.getFullYear(), d.getMonth(), 15).getTime() })
  }
  return { pct: (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100)), months }
}
