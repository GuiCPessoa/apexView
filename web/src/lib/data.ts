import type { DriverResult, Lap, SessionIndexEntry, SessionMeta } from '../types/data'

const BASE = `${import.meta.env.BASE_URL}data`

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

export const loadIndex = () => getJson<SessionIndexEntry[]>('index.json')
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
