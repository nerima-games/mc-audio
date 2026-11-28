---
"@nerima-games/mc-audio": minor
---

Add `oscillatorNodes` to `WebAudioReport`: the number of OscillatorNodes the oscillator fallback has created since the backend was constructed. The count is cumulative, so an ended tone still counts, and it stays 0 while playback uses decoded samples. The QA audio surface reads it through `report`.
