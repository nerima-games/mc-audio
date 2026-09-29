/**
 * Compile-only fixture for the vocabularies crossing the audio boundary.
 *
 * The kernel owns the biome, damage-type, and mob-effect vocabularies. This
 * package owns sound-cue ids. Keeping the four rosters in one typed fixture
 * makes a kernel vocabulary change fail here instead of being silently
 * treated as an untyped string by an audio consumer.
 */
import {
  BIOME_TYPES,
  BlockId,
  DAMAGE_TYPE_NAMES,
  DeltaTimeSecs,
  EpochMillis,
  MonotonicTimeSecs,
  STATUS_EFFECT_NAMES,
  type BiomeType,
  type DamageTypeName,
  type StatusEffectName,
} from '@nerima-games/mc-kernel'
import { canPlayMinecraftFireflyBushIdleSounds } from '../src/domain/minecraft-audio'
import { SOUND_CUE_IDS, type SoundCueId } from '../src/domain/cue'
import { type CaptionEvent, visibleCaptions } from '../src/domain/caption'

type Vocabulary = 'biome' | 'damageType' | 'mobEffect' | 'cue'
type AudioVocabularyTable = Readonly<Record<Vocabulary, readonly string[]>>

export const AUDIO_VOCABULARIES: AudioVocabularyTable = {
  biome: BIOME_TYPES,
  damageType: DAMAGE_TYPE_NAMES,
  mobEffect: STATUS_EFFECT_NAMES,
  cue: SOUND_CUE_IDS,
}

type Same<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
  ? true
  : false

type Assert<T extends true> = T

export type BiomeRosterMatchesKernel = Assert<Same<(typeof BIOME_TYPES)[number], BiomeType>>
export type DamageTypeRosterMatchesKernel = Assert<Same<(typeof DAMAGE_TYPE_NAMES)[number], DamageTypeName>>
export type MobEffectRosterMatchesKernel = Assert<Same<(typeof STATUS_EFFECT_NAMES)[number], StatusEffectName>>
export type CueRosterMatchesAudio = Assert<Same<(typeof SOUND_CUE_IDS)[number], SoundCueId>>

const monotonicNow = MonotonicTimeSecs(0)
const caption: CaptionEvent = {
  cueId: 'footstepGrass',
  text: 'Footsteps',
  atSecs: monotonicNow,
  reason: 'audible',
}

visibleCaptions([caption], monotonicNow)
// @ts-expect-error EpochMillis is not a monotonic timestamp.
visibleCaptions([caption], EpochMillis(0))
// @ts-expect-error DeltaTimeSecs is not a monotonic timestamp.
visibleCaptions([caption], DeltaTimeSecs(0))
// @ts-expect-error EpochMillis cannot populate a caption's monotonic timestamp.
const invalidCaption: CaptionEvent = { ...caption, atSecs: EpochMillis(0) }
void invalidCaption

canPlayMinecraftFireflyBushIdleSounds({
  fireflyBushSounds: true,
  belowBlockId: BlockId(0),
  belowOpaqueBlock: false,
})
canPlayMinecraftFireflyBushIdleSounds({
  fireflyBushSounds: true,
  // @ts-expect-error A plain number is not a kernel BlockId.
  belowBlockId: 0,
  belowOpaqueBlock: false,
})
