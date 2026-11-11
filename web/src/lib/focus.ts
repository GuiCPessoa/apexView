/**
 * Pilotos em foco no painel da sessão: destacados em todos os cartões e comparados na telemetria.
 * No máximo dois (A e B da telemetria); um terceiro clique substitui o mais antigo.
 */
export const MAX_FOCUS = 2

export function toggleFocus(focus: string[], driver: string): string[] {
  if (focus.includes(driver)) return focus.filter((d) => d !== driver)
  return [...focus, driver].slice(-MAX_FOCUS)
}

/** Opacidade de um elemento do piloto: todos normais sem foco; com foco, os outros ficam apagados. */
export function dimmed(focus: string[], driver: string): boolean {
  return focus.length > 0 && !focus.includes(driver)
}

/**
 * Par comparado na telemetria: os pilotos em foco, completados pelo par padrão
 * (sem repetir piloto). Só considera quem tem telemetria exportada.
 */
export function telemetryPair(
  focus: string[],
  defaults: [string | null, string | null],
  available: string[],
): [string | null, string | null] {
  const pool = [...focus.filter((d) => available.includes(d)), ...defaults.filter((d): d is string => d != null)]
  const unique = [...new Set(pool)]
  return [unique[0] ?? null, unique[1] ?? null]
}
