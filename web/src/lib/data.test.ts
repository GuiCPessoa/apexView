import { describe, expect, it } from 'vitest'
import { deltaDecode } from './data'

describe('deltaDecode', () => {
  it('desfaz o delta_encode do pipeline, recomeçando depois de lacunas', () => {
    expect(deltaDecode([100, 3, null, 50, 2])).toEqual([100, 103, null, 50, 52])
    expect(deltaDecode([null, 5, -1])).toEqual([null, 5, 4])
    expect(deltaDecode([])).toEqual([])
  })
})
