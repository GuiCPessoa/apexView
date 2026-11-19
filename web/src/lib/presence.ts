import { useEffect, useState } from 'react'

/**
 * Contador de pessoas com o site aberto, pela presença do Firebase Realtime Database.
 *
 * Cada aba grava `presence/{navegador}/{aba}: true` e o Firebase apaga a entrada sozinho quando
 * a conexão cai (onDisconnect). O número mostrado é o de navegadores: várias abas da mesma
 * pessoa contam uma vez. Nada além disso é gravado (nem nome, nem IP, nem histórico).
 *
 * O endereço do banco é público por natureza (como a configuração web do Firebase); quem
 * protege o banco são as regras em firebase/database.rules.json.
 */

/**
 * Banco da presença (projeto Firebase "apexView", plano gratuito Spark). Troque com
 * VITE_PRESENCE_DB_URL; vazio desliga o contador (ele some da barra).
 */
export const PRESENCE_DB_URL: string =
  import.meta.env.VITE_PRESENCE_DB_URL ?? 'https://apexview-6bf6f-default-rtdb.firebaseio.com'

const BROWSER_KEY = 'apexview:presence-id'
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
/** Mesmo formato exigido pelas regras do banco. */
export const PRESENCE_ID = /^[A-Za-z0-9_-]{20}$/

/** Identificador aleatório de 20 caracteres (sem relação com a pessoa). */
export function randomId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(20), (b) => ID_CHARS[b & 63]).join('')
}

interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Identificador deste navegador, guardado para não contar duas vezes quem abre várias abas. */
export function browserId(store: KeyValueStore | null, make: () => string = randomId): string {
  try {
    const saved = store?.getItem(BROWSER_KEY)
    if (saved && PRESENCE_ID.test(saved)) return saved
    const id = make()
    store?.setItem(BROWSER_KEY, id)
    return id
  } catch {
    return make() // armazenamento bloqueado: conta esta aba como um navegador
  }
}

/** Pessoas online: navegadores com pelo menos uma aba conectada. */
export function countOnline(presence: unknown): number {
  if (!presence || typeof presence !== 'object') return 0
  return Object.values(presence as Record<string, unknown>).filter(
    (tabs) => tabs != null && typeof tabs === 'object' && Object.keys(tabs).length > 0,
  ).length
}

/** forceWebSockets precisa vir antes da primeira conexão e só uma vez por página. */
let transportPinned = false

function localStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Quantas pessoas estão com o site aberto agora (null enquanto não sabe ou se estiver desligado).
 * O SDK do Firebase só é baixado com o navegador ocioso, fora do carregamento inicial.
 */
export function useOnlineCount(dbUrl: string = PRESENCE_DB_URL): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!dbUrl) return
    let stopped = false
    let stop: (() => void) | null = null

    const start = async () => {
      const [{ initializeApp, getApps }, db] = await Promise.all([import('@firebase/app'), import('@firebase/database')])
      if (stopped) return
      if (!transportPinned) {
        // Só WebSocket. Depois de uma falha de conexão, o SDK grava "previous_websocket_failure"
        // no localStorage e passa a começar pelo long-polling, que carrega scripts do Firebase
        // e é barrado pela CSP (script-src 'self'): o contador nunca mais conectava naquele navegador.
        db.forceWebSockets()
        transportPinned = true
      }
      const app = getApps().find((a) => a.name === 'presence') ?? initializeApp({ databaseURL: dbUrl }, 'presence')
      const database = db.getDatabase(app)
      db.goOnline(database) // a mesma instância pode ter sido desligada por uma montagem anterior
      const me = db.ref(database, `presence/${browserId(localStore())}/${randomId()}`)
      // a cada (re)conexão: agenda a remoção para quando cair e marca esta aba como online
      const offConnected = db.onValue(db.ref(database, '.info/connected'), (snap) => {
        if (snap.val() !== true) return
        db.onDisconnect(me)
          .remove()
          .then(() => db.set(me, true))
          .catch(() => undefined)
      })
      const offCount = db.onValue(
        db.ref(database, 'presence'),
        (snap) => setCount(countOnline(snap.val())),
        () => setCount(null), // sem permissão ou banco fora do ar: esconde o contador
      )
      stop = () => {
        offConnected()
        offCount()
        void db.remove(me).catch(() => undefined)
        db.goOffline(database)
      }
    }

    const begin = () => void start().catch(() => setCount(null))
    let cancel: () => void
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(begin, { timeout: 5000 })
      cancel = () => cancelIdleCallback(id)
    } else {
      const id = setTimeout(begin, 2500)
      cancel = () => clearTimeout(id)
    }
    return () => {
      stopped = true
      cancel()
      stop?.()
    }
  }, [dbUrl])

  return count
}
