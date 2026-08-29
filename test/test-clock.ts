import { EpochMillis, FixedClockLayer, MonotonicTimeSecs } from '@nerima-games/mc-kernel'

export const testClockLayer = (atSecs: number) =>
  FixedClockLayer({
    monotonicSecs: MonotonicTimeSecs(atSecs),
    wallClockEpochMillis: EpochMillis(0),
  })

