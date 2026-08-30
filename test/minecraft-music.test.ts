/* oxlint-disable max-statements, no-magic-numbers */
import { describe, expect, it } from 'vitest'
import {
  MINECRAFT_BACKGROUND_MUSIC,
  MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
  MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
  MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
  initialMinecraftMusicState,
  normalizeMinecraftBiomeMusic,
  normalizeMinecraftBiomeMusicDefinition,
  normalizeMinecraftMusicDefinition,
  planMinecraftMusic,
  resolveMinecraftBackgroundMusicDefinition,
  resolveMinecraftMusicDefinition,
  selectMinecraftBiomeMusicDefinition,
  type MinecraftBiomeMusicDefinition,
  type MinecraftMusicDefinition,
  type MinecraftMusicPlannerInput,
  type MinecraftMusicState,
} from '../src/domain/minecraft-music.js'

const definition = (overrides: Partial<MinecraftMusicDefinition> = {}): MinecraftMusicDefinition => ({
  max_delay: 0,
  min_delay: 0,
  sound: 'minecraft:music.game',
  ...overrides,
})

const state = (overrides: Partial<MinecraftMusicState> = {}): MinecraftMusicState => ({
  currentGain: 0,
  currentSound: null,
  nextSongDelayTicks: 0,
  ...overrides,
})

const plan = (overrides: Partial<MinecraftMusicPlannerInput> = {}) =>
  planMinecraftMusic({
    currentActive: true,
    desired: definition(),
    enabled: true,
    musicVolume: 1,
    randomIntInclusive: () => 0,
    state: state(),
    ...overrides,
  } as MinecraftMusicPlannerInput)

describe('minecraft music definitions', () => {
  it('resolves the vanilla context priority', () => {
    expect(resolveMinecraftMusicDefinition({ underwater: true, creative: true })).toBe(
      MINECRAFT_BACKGROUND_MUSIC.underwater,
    )
    expect(resolveMinecraftMusicDefinition({ underwater: false, creative: true })).toBe(
      MINECRAFT_BACKGROUND_MUSIC.creative,
    )
    expect(resolveMinecraftMusicDefinition({ underwater: false, creative: false })).toBe(
      MINECRAFT_BACKGROUND_MUSIC.default,
    )
  })

  it('resolves data-driven background music and leaves missing entries silent', () => {
    const backgroundMusic = {
      creative: definition({ sound: 'minecraft:music.creative' }),
      default: definition({ sound: 'minecraft:music.game' }),
      underwater: definition({ sound: 'minecraft:music.under_water' }),
    }

    expect(
      resolveMinecraftBackgroundMusicDefinition(backgroundMusic, {
        creative: true,
        underwater: true,
      }),
    ).toBe(backgroundMusic.underwater)
    expect(
      resolveMinecraftBackgroundMusicDefinition(backgroundMusic, {
        creative: true,
        underwater: false,
      }),
    ).toBe(backgroundMusic.creative)
    expect(resolveMinecraftBackgroundMusicDefinition({}, { creative: false, underwater: false })).toBeNull()
    expect(
      resolveMinecraftBackgroundMusicDefinition(
        { default: null },
        { creative: false, underwater: false },
      ),
    ).toBeNull()
  })

  it('normalizes defaults and rejects invalid delays', () => {
    expect(normalizeMinecraftMusicDefinition(definition())).toEqual({
      max_delay: 0,
      min_delay: 0,
      replace_current_music: false,
      sound: 'minecraft:music.game',
    })
    expect(
      normalizeMinecraftMusicDefinition(
        definition({
          max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
          min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
          replace_current_music: true,
        }),
      ),
    ).toEqual({
      max_delay: MINECRAFT_MUSIC_DEFAULT_MAX_DELAY_TICKS,
      min_delay: MINECRAFT_MUSIC_DEFAULT_MIN_DELAY_TICKS,
      replace_current_music: true,
      sound: 'minecraft:music.game',
    })

    for (const invalid of [
      null as unknown as MinecraftMusicDefinition,
      [] as unknown as MinecraftMusicDefinition,
      definition({ sound: '' }),
      definition({ min_delay: -1 }),
      definition({ min_delay: 0.5 }),
      definition({ max_delay: -1 }),
      definition({ max_delay: 0.5 }),
      definition({ max_delay: -1, min_delay: 0 }),
      definition({ max_delay: 1, min_delay: 2 }),
      definition({ replace_current_music: 'true' as unknown as boolean }),
      { ...definition(), unknown: true } as unknown as MinecraftMusicDefinition,
    ]) {
      expect(() => normalizeMinecraftMusicDefinition(invalid)).toThrow()
    }
  })

  it('normalizes weighted biome music and rejects invalid weights', () => {
    const weighted: MinecraftBiomeMusicDefinition = {
      data: definition({ sound: 'minecraft:music.creative' }),
      weight: 3,
    }
    expect(normalizeMinecraftBiomeMusicDefinition(weighted)).toEqual({
      max_delay: 0,
      min_delay: 0,
      replace_current_music: false,
      sound: 'minecraft:music.creative',
      weight: 3,
    })
    expect(normalizeMinecraftBiomeMusic([weighted])).toHaveLength(1)
    expect(normalizeMinecraftBiomeMusic([])).toStrictEqual([])

    for (const invalid of [
      null as unknown as number,
      [] as unknown as number,
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1' as unknown as number,
    ]) {
      expect(() => normalizeMinecraftBiomeMusicDefinition({ data: definition(), weight: invalid })).toThrow()
    }
    expect(
      () =>
        normalizeMinecraftBiomeMusicDefinition({
          data: definition(),
          unknown: true,
          weight: 1,
        } as unknown as MinecraftBiomeMusicDefinition),
    ).toThrow()
    expect(() => normalizeMinecraftBiomeMusicDefinition({ ...definition(), weight: 1 } as never)).toThrow()
  })

  it('selects weighted biome music without exposing the internal weight', () => {
    const music: readonly MinecraftBiomeMusicDefinition[] = [
      { data: definition({ sound: 'minecraft:music.game' }), weight: 1 },
      { data: definition({ sound: 'minecraft:music.creative' }), weight: 3 },
    ]
    expect(selectMinecraftBiomeMusicDefinition([], 0)).toBeNull()
    expect(selectMinecraftBiomeMusicDefinition(music, 0)).toStrictEqual({
      max_delay: 0,
      min_delay: 0,
      replace_current_music: false,
      sound: 'minecraft:music.game',
    })
    expect(selectMinecraftBiomeMusicDefinition(music, 0.5)?.sound).toBe('minecraft:music.creative')
    expect(selectMinecraftBiomeMusicDefinition(music, -1)?.sound).toBe('minecraft:music.game')
    expect(selectMinecraftBiomeMusicDefinition(music, 2)?.sound).toBe('minecraft:music.creative')
    expect(selectMinecraftBiomeMusicDefinition(music, Number.NaN)?.sound).toBe('minecraft:music.game')
    expect(
      selectMinecraftBiomeMusicDefinition(
        [
          { data: definition({ sound: 'minecraft:music.game' }), weight: Number.MAX_VALUE },
          { data: definition({ sound: 'minecraft:music.creative' }), weight: Number.MAX_VALUE },
        ],
        0.5,
      )?.sound,
    ).toBe('minecraft:music.creative')
  })
})

describe('minecraft music planning', () => {
  it('starts from the vanilla initial state', () => {
    expect(initialMinecraftMusicState()).toEqual({
      currentGain: 0,
      currentSound: null,
      nextSongDelayTicks: MINECRAFT_MUSIC_STARTING_DELAY_TICKS,
    })
  })

  it('stops and resets when music is disabled or has no definition', () => {
    const active = state({ currentGain: 0.5, currentSound: 'minecraft:music.game' })
    expect(plan({ desired: null, state: active })).toEqual({
      commands: [{ kind: 'stop' }],
      state: initialMinecraftMusicState(),
    })
    expect(plan({ enabled: false, state: active })).toEqual({
      commands: [{ kind: 'stop' }],
      state: initialMinecraftMusicState(),
    })
    expect(plan({ enabled: false })).toEqual({ commands: [], state: initialMinecraftMusicState() })
  })

  it('schedules the next track using the selected definition after the current track ends', () => {
    expect(
      plan({
        currentActive: false,
        desired: definition({ max_delay: 4, min_delay: 2 }),
        randomIntInclusive: () => 3,
        state: state({ currentGain: 0.5, currentSound: 'minecraft:music.game', nextSongDelayTicks: 4 }),
      }),
    ).toEqual({ commands: [], state: state({ nextSongDelayTicks: 3 }) })
  })

  it('moves the current gain in bounded steps', () => {
    expect(plan({ state: state({ currentGain: 0, currentSound: 'minecraft:music.game' }) })).toEqual({
      commands: [{ gain: 0.05, kind: 'gain' }],
      state: state({ currentGain: 0.05, currentSound: 'minecraft:music.game' }),
    })
    expect(
      plan({
        musicVolume: 0,
        state: state({ currentGain: 1, currentSound: 'minecraft:music.game' }),
      }),
    ).toEqual({
      commands: [{ gain: 0.95, kind: 'gain' }],
      state: state({ currentGain: 0.95, currentSound: 'minecraft:music.game' }),
    })
    expect(
      plan({
        musicVolume: 0.5,
        state: state({ currentGain: 0.5, currentSound: 'minecraft:music.game' }),
      }),
    ).toEqual({
      commands: [],
      state: state({ currentGain: 0.5, currentSound: 'minecraft:music.game' }),
    })
  })

  it('does not replace an active track unless requested', () => {
    expect(
      plan({
        desired: definition({ sound: 'minecraft:music.creative', replace_current_music: false }),
        state: state({ currentGain: 1, currentSound: 'minecraft:music.game' }),
      }),
    ).toEqual({
      commands: [],
      state: state({ currentGain: 1, currentSound: 'minecraft:music.game' }),
    })
  })

  it('replaces an active track and chooses a bounded next delay', () => {
    expect(
      plan({
        desired: definition({
          max_delay: 4,
          min_delay: 2,
          replace_current_music: true,
          sound: 'minecraft:music.creative',
        }),
        randomIntInclusive: () => 4,
        state: state({ currentGain: 0.4, currentSound: 'minecraft:music.game' }),
      }),
    ).toEqual({
      commands: [
        { kind: 'stop' },
        {
          definition: {
            max_delay: 4,
            min_delay: 2,
            replace_current_music: true,
            sound: 'minecraft:music.creative',
          },
          gain: 1,
          kind: 'start',
        },
      ],
      state: state({
        currentGain: 1,
        currentSound: 'minecraft:music.creative',
        nextSongDelayTicks: 4,
      }),
    })
  })

  it('counts down before starting and clamps generated delays', () => {
    expect(plan({ state: state({ nextSongDelayTicks: 2 }) })).toEqual({
      commands: [],
      state: state({ nextSongDelayTicks: 1 }),
    })
    expect(
      plan({
        desired: definition({ max_delay: 4, min_delay: 2 }),
        randomIntInclusive: () => -1,
      }),
    ).toEqual({
      commands: [
        {
          definition: {
            max_delay: 4,
            min_delay: 2,
            replace_current_music: false,
            sound: 'minecraft:music.game',
          },
          gain: 1,
          kind: 'start',
        },
      ],
      state: state({ currentGain: 1, currentSound: 'minecraft:music.game', nextSongDelayTicks: 2 }),
    })
    expect(
      plan({
        desired: definition({ max_delay: 4, min_delay: 2 }),
        randomIntInclusive: () => 99,
      }),
    ).toEqual({
      commands: [
        {
          definition: {
            max_delay: 4,
            min_delay: 2,
            replace_current_music: false,
            sound: 'minecraft:music.game',
          },
          gain: 1,
          kind: 'start',
        },
      ],
      state: state({ currentGain: 1, currentSound: 'minecraft:music.game', nextSongDelayTicks: 4 }),
    })
    expect(
      plan({
        desired: definition({ max_delay: 4, min_delay: 2 }),
        randomIntInclusive: () => Number.NaN,
      }),
    ).toEqual({
      commands: [
        {
          definition: {
            max_delay: 4,
            min_delay: 2,
            replace_current_music: false,
            sound: 'minecraft:music.game',
          },
          gain: 1,
          kind: 'start',
        },
      ],
      state: state({ currentGain: 1, currentSound: 'minecraft:music.game', nextSongDelayTicks: 2 }),
    })
  })
})
