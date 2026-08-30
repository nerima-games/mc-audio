import { EpochMillis, FixedClockLayer, MonotonicTimeSecs, type ClockPort } from '@nerima-games/mc-kernel'
import type { Layer } from 'effect'

export const testClockLayer = (atSecs: number): Layer.Layer<ClockPort> =>
  FixedClockLayer({
    monotonicSecs: MonotonicTimeSecs(atSecs),
    wallClockEpochMillis: EpochMillis(0),
  })

