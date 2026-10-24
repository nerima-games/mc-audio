import { BlockId } from '@nerima-games/mc-kernel/domain/block-registry'
import { DeltaTimeSecs, EpochMillis, MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { canPlayMinecraftFireflyBushIdleSounds } from '../src/domain/minecraft-audio'
import { AudioCaptionText } from '../src/domain/audio-brands'
import { type CaptionEvent, visibleCaptions } from '../src/domain/caption'
import { SoundCueId } from '../src/domain/cue'

const monotonicNow = MonotonicTimeSecs(0)
const caption: CaptionEvent = {
  cueId: SoundCueId('footstepGrass'),
  text: AudioCaptionText('Footsteps'),
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
