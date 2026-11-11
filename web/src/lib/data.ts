import type {
  Calendar,
  DataIndex,
  DriverPositions,
  DriverResult,
  DriverTelemetry,
  Lap,
  SessionMeta,
  Standings,
  Track,
  TrackStatusChange,
} from '../types/data'

const BASE = `${import.meta.env.BASE_URL}data`

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

/**
 * Lê um .json.gz. Alguns servidores já descomprimem (Content-Encoding: gzip) e outros
 * entregam os bytes crus (GitHub Pages, Vite); por isso checamos a assinatura do gzip.
 */
async function getJsonGz<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (HTTP ${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(stream).text()) as T
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

export const loadIndex = () => getJson<DataIndex>('index.json')
export const loadCalendar = (year: number) => getJson<Calendar>(`${year}/calendar.json`)
export const loadStandings = (year: number) => getJson<Standings>(`${year}/standings.json`)
export const loadMeta = (path: string) => getJson<SessionMeta>(`${path}/meta.json`)
export const loadResults = (path: string) => getJson<DriverResult[]>(`${path}/results.json`)
export const loadLaps = (path: string) => getJson<Lap[]>(`${path}/laps.json`)
export const loadTrack = (path: string) => getJson<Track>(`${path}/track.json`)
export const loadTrackStatus = (path: string) => getJson<TrackStatusChange[]>(`${path}/track_status.json`)
export const loadTelemetry = (path: string, driver: string) =>
  getJsonGz<DriverTelemetry>(`${path}/telemetry/${driver}.json.gz`)
export const loadPositions = (path: string, driver: string) =>
  getJsonGz<DriverPositions>(`${path}/positions/${driver}.json.gz`)

/** 83.456 -> "1:23.456" */
export function formatLapTime(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3)
}

/** Diferença em segundos: "+0.123"; vazio para zero (o próprio líder). */
export function formatGap(v: number | null): string {
  if (v == null) return '—'
  return v === 0 ? '' : `+${v.toFixed(3)}`
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
