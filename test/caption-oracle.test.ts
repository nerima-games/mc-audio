import { MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import { describe, expect, it } from 'vitest'
import { AudioCaptionText, MinecraftSoundEventId } from '../src/domain/audio-brands'
import {
  applyCaptionSettings,
  CAPTION_LIFETIME_SECS,
  emptyCaptionQueue,
  expireCaptions,
  MAX_VISIBLE_CAPTIONS,
  receiveCaption,
  type CaptionEvent,
  type CaptionQueue,
  type CaptionSettings,
} from '../src/domain/caption'

const ENABLED: CaptionSettings = { audioUnlocked: false, captionsEnabled: true }
const DISABLED: CaptionSettings = { audioUnlocked: true, captionsEnabled: false }

const caption = (cueId: string, atSecs: number): CaptionEvent => ({
  atSecs: MonotonicTimeSecs(atSecs),
  cueId: MinecraftSoundEventId(cueId),
  reason: 'audible',
  text: AudioCaptionText(cueId),
})

describe('caption queue', () => {
  it('admits captions before audio unlock and gates only on the player setting', () => {
    const incoming = caption('blockBreak', 1)
    const live = receiveCaption(emptyCaptionQueue, incoming, ENABLED)

    expect(live.visible).toStrictEqual([incoming])
    expect(receiveCaption(live, caption('levelUp', 2), DISABLED)).toBe(live)
  })

  it('clears existing captions when disabled and keeps identity while enabled', () => {
    const live = receiveCaption(emptyCaptionQueue, caption('blockBreak', 1), ENABLED)
    const distinctEmptyQueue: CaptionQueue = { visible: [] }

    expect(applyCaptionSettings(live, ENABLED)).toBe(live)
    expect(applyCaptionSettings(live, DISABLED)).toBe(emptyCaptionQueue)
    expect(applyCaptionSettings(emptyCaptionQueue, DISABLED)).toBe(emptyCaptionQueue)
    expect(applyCaptionSettings(distinctEmptyQueue, DISABLED)).toBe(distinctEmptyQueue)
  })

  it('refreshes duplicate cues and keeps the newest five entries first', () => {
    const first = caption('blockBreak', 1)
    const refreshed = caption('blockBreak', 2)
    const queue = receiveCaption(receiveCaption(emptyCaptionQueue, first, ENABLED), refreshed, ENABLED)

    expect(queue.visible).toStrictEqual([refreshed])

    let overfull = emptyCaptionQueue
    for (let index = 0; index < MAX_VISIBLE_CAPTIONS + 3; index += 1) {
      overfull = receiveCaption(overfull, caption(`cue-${String(index)}`, index), ENABLED)
    }

    expect(overfull.visible).toHaveLength(MAX_VISIBLE_CAPTIONS)
    expect(overfull.visible.map((event) => event.cueId)).toStrictEqual(['cue-7', 'cue-6', 'cue-5', 'cue-4', 'cue-3'])
  })

  it('expires at the lifetime boundary and preserves identity before expiry', () => {
    const live = receiveCaption(emptyCaptionQueue, caption('blockBreak', 0), ENABLED)

    expect(CAPTION_LIFETIME_SECS).toBe(2.5)
    expect(expireCaptions(live, MonotonicTimeSecs(CAPTION_LIFETIME_SECS - 0.001))).toBe(live)
    expect(expireCaptions(live, MonotonicTimeSecs(CAPTION_LIFETIME_SECS)).visible).toStrictEqual([])
  })
})
