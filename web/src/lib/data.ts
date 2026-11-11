import type { Calendar, DataIndex, DriverResult, Lap, SessionMeta, Standings } from '../types/data'

const BASE = `${import.meta.env.BASE_URL}data`

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

export const loadIndex = () => getJson<DataIndex>('index.json')
export const loadCalendar = (year: number) => getJson<Calendar>(`${year}/calendar.json`)
export const loadStandings = (year: number) => getJson<Standings>(`${year}/standings.json`)
export const loadMeta = (path: string) => getJson<SessionMeta>(`${path}/meta.json`)
export const loadResults = (path: string) => getJson<DriverResult[]>(`${path}/results.json`)
export const loadLaps = (path: string) => getJson<Lap[]>(`${path}/laps.json`)

/** 83.456 -> "1:23.456" */
export function formatLapTime(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3)
}

/** Pontos sem ".0" desnecessário: 25 -> "25", 0.5 -> "0,5" */
export function formatPoints(points: number): string {
  return points.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

/** Data/hora de início no fuso do navegador. Aceita "YYYY-MM-DD" (sem horário). */
export function formatSessionStart(start: string | null, withTime = true): string {
  if (!start) return 'A definir'
  const dateOnly = start.length === 10
  const date = new Date(dateOnly ? `${start}T12:00:00Z` : start)
  const day = date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
  if (dateOnly || !withTime) return day
  return `${day} · ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
