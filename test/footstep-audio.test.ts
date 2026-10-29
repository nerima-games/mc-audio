import { BLOCK_TYPES } from '@nerima-games/mc-kernel/domain/block-type'
import { Result } from 'effect'
import * as fc from 'fast-check'
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

  it('classifies special surfaces and keeps the default for known unclassified blocks', () => {
    const blockTypes = [
      { names: ['dirt', 'grass_block', 'farmland'], surface: 'grass' },
      { names: ['oak_log', 'oak_leaves', 'oak_planks', 'sapling', 'ladder', 'chest', 'door'], surface: 'wood' },
      { names: ['stone', 'sand', 'gravel', 'cobblestone', 'end_stone_bricks'], surface: 'stone' },
    ] as const

    for (const { names, surface } of blockTypes) {
      for (const name of names) {
        const result = surfaceForBlockType(name)
        expect(Result.isSuccess(result) && result.success).toBe(surface)
      }
    }
    const glass = surfaceForBlockType('glass')
    expect(Result.isSuccess(glass) && glass.success).toBe('default')
  })

  it('accepts known block types and rejects names immediately outside the kernel vocabulary', () => {
    expect(BLOCK_TYPES.length).toBeGreaterThan(0)
    const registeredBlockType = fc.constantFrom(...BLOCK_TYPES)
    fc.assert(fc.property(registeredBlockType, (blockType) => {
      const result = surfaceForBlockType(blockType)
      return Result.isSuccess(result)
    }), { numRuns: 100 })

    fc.assert(fc.property(registeredBlockType, (blockType) => {
      const unknownBlockType = `${blockType}__unknown`
      const result = surfaceForBlockType(unknownBlockType)
      return Result.isFailure(result) &&
        result.failure.reason === 'unknown-block-type' &&
        result.failure.blockType === unknownBlockType
    }), { numRuns: 100 })

    fc.assert(fc.property(fc.integer(), (blockType) => {
      const result = surfaceForBlockType(blockType)
      return Result.isFailure(result) &&
        result.failure.reason === 'invalid-type' &&
        result.failure.blockType === null
    }), { numRuns: 100 })

    const nullValue = surfaceForBlockType(null)
    expect(Result.isFailure(nullValue) && nullValue.failure.reason).toBe('invalid-type')
  })
})
