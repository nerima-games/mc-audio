import { FixedClockLayer, type ClockPort } from '@nerima-games/mc-kernel/domain/clock'
import { EpochMillis, MonotonicTimeSecs } from '@nerima-games/mc-kernel/domain/quantities'
import type { Layer } from 'effect'

export const testClockLayer = (atSecs: number): Layer.Layer<ClockPort> =>
  FixedClockLayer({
    monotonicSecs: MonotonicTimeSecs(atSecs),
    wallClockEpochMillis: EpochMillis(0),
  })

