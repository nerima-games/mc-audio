import { describe, expect, it } from 'vitest'
import {
  cueForSurface,
  FOOTSTEP_SURFACES,
  footstepCueFor,
  surfaceForBlockType,
} from '../src/domain/footstep'

describe('footstep audio mapping', () => {
  it('maps only audible surfaces to their registered cues', () => {
    expect(FOOTSTEP_SURFACES).toStrictEqual(['default', 'grass', 'wood', 'stone'])
    expect(cueForSurface('grass')).toBe('footstepGrass')
    expect(cueForSurface('wood')).toBe('footstepWood')
    expect(cueForSurface('stone')).toBe('footstepStone')
    expect(cueForSurface('default')).toBeUndefined()
    expect(footstepCueFor).toBe(cueForSurface)
  })

  it('classifies the package block vocabulary and defaults unknown blocks', () => {
    const blockTypes = [
      { names: ['dirt', 'grass_block', 'farmland'], surface: 'grass' },
      { names: ['oak_log', 'oak_leaves', 'oak_planks', 'sapling', 'ladder', 'chest', 'door'], surface: 'wood' },
      { names: ['stone', 'sand', 'gravel', 'cobblestone', 'end_stone_bricks'], surface: 'stone' },
    ] as const

    for (const { names, surface } of blockTypes) {
      for (const name of names) {
        expect(surfaceForBlockType(name)).toBe(surface)
      }
    }
    expect(surfaceForBlockType('glass')).toBe('default')
  })
})
