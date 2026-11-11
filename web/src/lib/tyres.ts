/** Compostos de pneu: nome em português, letra no padrão da F1 (S/M/H/I/W) e classe CSS. */
export const COMPOUND: Record<string, { label: string; letter: string; className: string }> = {
  SOFT: { label: 'Macio', letter: 'S', className: 'soft' },
  MEDIUM: { label: 'Médio', letter: 'M', className: 'medium' },
  HARD: { label: 'Duro', letter: 'H', className: 'hard' },
  INTERMEDIATE: { label: 'Intermediário', letter: 'I', className: 'inter' },
  WET: { label: 'Chuva', letter: 'W', className: 'wet' },
}
