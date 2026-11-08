/* oxlint-disable no-magic-numbers -- Musical intervals, sample rates, and envelope values are source notation for this synthesizer. */
/* oxlint-disable no-bitwise -- Unsigned xorshift PRNG and 32-bit seed mixing are required for byte-stable procedural noise. */
/* oxlint-disable no-await-in-loop -- PCM blocks and encoded files are processed serially to bound temporary memory and disk use. */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const BLOCK_FRAMES = 4_096
const TARGET_RMS = 10 ** (-18 / 20)
const PEAK_LIMIT = 10 ** (-1.5 / 20)
const ENCODE_BITRATE = '80k'
const DEFAULT_SEED = 482_712
const SCENES = [
  {
    bpm: 80,
    key: 'C Lydian',
    keyOffset: 0,
    lead: 'crystal',
    mode: [0, 2, 4, 6, 7, 9, 11],
    name: 'title',
    pad: 'warm',
    percussion: 'none',
    timbre: 'glass pluck and warm pad',
  },
  {
    bpm: 96,
    key: 'D major',
    keyOffset: 2,
    lead: 'wood',
    mode: [0, 2, 4, 5, 7, 9, 11],
    name: 'day',
    pad: 'strings',
    percussion: 'shaker',
    timbre: 'wood pluck, strings and light shaker',
  },
  {
    bpm: 72,
    key: 'A natural minor',
    keyOffset: 9,
    lead: 'bell',
    mode: [0, 2, 3, 5, 7, 8, 10],
    name: 'night',
    pad: 'warm',
    percussion: 'none',
    timbre: 'bell melody and soft low bass',
  },
  {
    bpm: 88,
    key: 'E Phrygian',
    keyOffset: 4,
    lead: 'wood',
    mode: [0, 1, 3, 5, 7, 8, 10],
    name: 'cave',
    pad: 'drone',
    percussion: 'drip',
    timbre: 'low muted drone with water drops',
  },
  {
    bpm: 112,
    key: 'F-sharp harmonic minor',
    keyOffset: 6,
    lead: 'saw',
    mode: [0, 2, 3, 5, 7, 8, 11],
    name: 'nether',
    pad: 'organ',
    percussion: 'pulse',
    timbre: 'low saw and metallic pulse',
  },
  {
    bpm: 84,
    key: 'C-sharp minor',
    keyOffset: 1,
    lead: 'crystal',
    mode: [0, 2, 3, 5, 7, 8, 10],
    name: 'end',
    pad: 'airy',
    percussion: 'none',
    timbre: 'sparse bell and airy pad',
  },
  {
    bpm: 120,
    key: 'G minor',
    keyOffset: 7,
    lead: 'wood',
    mode: [0, 2, 3, 5, 7, 8, 10],
    name: 'combat',
    pad: 'strings',
    percussion: 'woodblock',
    timbre: 'clear pulse and wooden percussion',
  },
  {
    bpm: 76,
    key: 'F major',
    keyOffset: 5,
    lead: 'flute',
    mode: [0, 2, 4, 5, 7, 9, 10],
    name: 'underwater',
    pad: 'water',
    percussion: 'none',
    timbre: 'round sine arpeggio and soft pad',
  },
  {
    bpm: 104,
    key: 'E Mixolydian',
    keyOffset: 4,
    lead: 'mallet',
    mode: [0, 2, 4, 5, 7, 9, 10],
    name: 'creative',
    pad: 'warm',
    percussion: 'shaker',
    timbre: 'bright pluck and gentle shaker',
  },
]

const CUES = [
  { id: 'achievementUnlock', duration: 1.6, kind: 'arpeggio', base: 523.25 },
  { id: 'blockBreak', duration: 0.36, kind: 'crunch', base: 112 },
  { id: 'blockPlace', duration: 0.24, kind: 'thunk', base: 185 },
  { id: 'enchant', duration: 1.1, kind: 'shimmer', base: 659.25 },
  { id: 'entityHit', duration: 0.18, kind: 'impact', base: 240 },
  { id: 'footstepDefault', duration: 0.16, kind: 'step', base: 155 },
  { id: 'footstepGrass', duration: 0.17, kind: 'rustleStep', base: 145 },
  { id: 'footstepStone', duration: 0.14, kind: 'stoneStep', base: 205 },
  { id: 'footstepWood', duration: 0.17, kind: 'woodStep', base: 170 },
  { id: 'inventoryClose', duration: 0.22, kind: 'close', base: 245 },
  { id: 'inventoryOpen', duration: 0.24, kind: 'open', base: 430 },
  { id: 'itemPickup', duration: 0.34, kind: 'pickup', base: 783.99 },
  { id: 'levelUp', duration: 1.3, kind: 'arpeggio', base: 440 },
  { id: 'mobDeath', duration: 0.7, kind: 'falling', base: 180 },
  { id: 'mobHurt', duration: 0.31, kind: 'impact', base: 165 },
  { id: 'playerHurt', duration: 0.33, kind: 'impact', base: 132 },
  { id: 'rainAmbient', duration: 1.2, kind: 'rain', base: 600 },
  { id: 'thunderClap', duration: 1.4, kind: 'thunder', base: 55 },
]

const PROGRESSION = [0, 5, 3, 4, 0, 2, 5, 4, 0, 5, 3, 4, 0, 2, 5, 0]
const MELODY_PATTERN = [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 6, 5, 3, 2, 1]
const ROOT_FREQUENCY = 440
const A4_MIDI = 69
const HALF_STEPS_PER_OCTAVE = 12
const BEATS_PER_BAR = 4
const PHRASE_BARS = 16
const SONG_BARS = 32
const NOTE_EIGHTH = 0.5
const MINUTE_SECONDS = 60

const parseArguments = (argv) => {
  const options = { outputDir: '.', seed: DEFAULT_SEED, cueId: null, scene: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') {
      options.help = true
      continue
    }
    if (argument === '--output-dir' || argument === '--seed' || argument === '--only-cue' || argument === '--only-scene') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      if (argument === '--output-dir') {
        options.outputDir = value
      } else if (argument === '--seed') {
        if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 0xffff_ffff) {
          throw new Error('--seed must be an integer from 1 through 4294967295')
        }
        options.seed = Number(value)
      } else if (argument === '--only-cue') {
        options.cueId = value
      } else {
        options.scene = value
      }
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  if (options.outputDir.length === 0) {
    throw new Error('--output-dir must not be empty')
  }
  if (options.cueId !== null && !CUES.some(({ id }) => id === options.cueId)) {
    throw new Error(`Unknown cue id: ${options.cueId}`)
  }
  if (options.scene !== null && !SCENES.some(({ name }) => name === options.scene)) {
    throw new Error(`Unknown music scene: ${options.scene}`)
  }
  return options
}

const createRandom = (seed) => {
  let state = seed >>> 0
  if (state === 0) {
    state = 0x6d2b79f5
  }
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const midiFrequency = (midi) => ROOT_FREQUENCY * (2 ** ((midi - A4_MIDI) / HALF_STEPS_PER_OCTAVE))
const dbToLinear = (db) => 10 ** (db / 20)
const cueEnvelope = (time, duration, attack, decay) => {
  const attackGain = clamp(time / attack, 0, 1)
  const releaseGain = Math.exp(-time / decay)
  const tail = clamp((duration - time) / Math.min(0.08, duration / 4), 0, 1)
  return attackGain * releaseGain * tail
}

const cueSample = ({ kind, base, duration, time, random }) => {
  const envelope = cueEnvelope(time, duration, 0.004, duration * 0.38)
  const noise = (random() * 2) - 1
  const phase = 2 * Math.PI
  if (kind === 'crunch') {
    const crackle = Math.max(0, Math.sin(phase * 18 * time)) ** 10
    return envelope * ((noise * 0.44) + (Math.sin(phase * base * time) * 0.44) + (crackle * 0.55))
  }
  if (kind === 'thunk' || kind === 'close' || kind === 'open') {
    const pitch = base * (1 - (0.23 * time / duration))
    return envelope * ((Math.sin(phase * pitch * time) * 0.75) + (Math.sin(phase * pitch * 2 * time) * 0.14) + (noise * 0.12))
  }
  if (kind === 'impact') {
    const pitch = base * (1 - (0.32 * time / duration))
    return envelope * ((noise * 0.68) + (Math.sin(phase * pitch * time) * 0.48) + (Math.sin(phase * pitch * 1.47 * time) * 0.15))
  }
  if (kind === 'step' || kind === 'stoneStep' || kind === 'woodStep' || kind === 'rustleStep') {
    const highNoise = kind === 'rustleStep' ? noise * 0.48 : noise * 0.22
    const pitch = base * (1 - (0.12 * time / duration))
    return envelope * (highNoise + (Math.sin(phase * pitch * time) * 0.68) + (Math.sin(phase * pitch * 2.03 * time) * 0.09))
  }
  if (kind === 'pickup' || kind === 'arpeggio') {
    const steps = kind === 'pickup' ? [0, 4, 7, 12] : [0, 4, 7, 11, 12, 16]
    const stepSeconds = duration / steps.length
    const stepIndex = Math.min(steps.length - 1, Math.floor(time / stepSeconds))
    const localTime = time - (stepIndex * stepSeconds)
    const frequency = base * (2 ** ((steps[stepIndex] ?? 0) / 12))
    const tone = Math.sin(phase * frequency * localTime) + (0.22 * Math.sin(phase * frequency * 2.01 * localTime))
    return cueEnvelope(localTime, stepSeconds, 0.008, stepSeconds * 1.3) * tone * 0.78
  }
  if (kind === 'shimmer') {
    const harmonicOne = Math.sin(phase * base * time)
    const harmonicTwo = Math.sin(phase * base * 1.498 * time)
    const harmonicThree = Math.sin(phase * base * 2.01 * time)
    return envelope * ((harmonicOne * 0.42) + (harmonicTwo * 0.32) + (harmonicThree * 0.18) + (noise * 0.08))
  }
  if (kind === 'falling') {
    const pitch = base * (1 - (0.65 * time / duration))
    return envelope * ((Math.sin(phase * pitch * time) * 0.66) + (Math.sin(phase * pitch * 0.51 * time) * 0.24) + (noise * 0.12))
  }
  if (kind === 'rain') {
    const drops = (Math.abs(Math.sin(phase * (base + (noise * 180)) * time)) ** 20) * 0.7
    return (noise * 0.11) + (drops * Math.exp(-time * 1.4))
  }
  if (kind === 'thunder') {
    const rumble = Math.sin(phase * (base + (noise * 3)) * time)
    const crack = Math.max(0, Math.sin(phase * 5.7 * time)) ** 34
    return (Math.exp(-time * 2.8) * ((noise * 0.38) + (rumble * 0.45) + (crack * 0.52)))
  }
  return 0
}

const addCue = ({ duration, id, kind, base, seed }) => {
  const frames = Math.round(duration * SAMPLE_RATE)
  const audio = new Float32Array(frames)
  const random = createRandom(seed)
  for (let frame = 0; frame < frames; frame += 1) {
    audio[frame] = cueSample({ base, duration, kind, random, time: frame / SAMPLE_RATE })
  }
  return { frames, id, left: audio, right: audio }
}

const degreeMidi = (scene, degree, octave) => {
  const scaleDegree = ((degree % scene.mode.length) + scene.mode.length) % scene.mode.length
  const scaleOctave = Math.floor(degree / scene.mode.length)
  const semitone = scene.mode[scaleDegree] ?? 0
  return 48 + scene.keyOffset + semitone + ((octave + scaleOctave) * 12)
}

const waveAt = (phase, instrument, velocity) => {
  const fundamental = Math.sin(phase)
  const second = Math.sin(phase * 2)
  const third = Math.sin(phase * 3)
  if (instrument === 'brass') {
    return (fundamental * 0.54) + (second * 0.28) + (third * 0.13)
  }
  if (instrument === 'saw') {
    const normalizedPhase = (phase / (2 * Math.PI)) - Math.floor((phase / (2 * Math.PI)) + 0.5)
    return (fundamental * 0.5) + (normalizedPhase * 0.44) + (second * 0.06)
  }
  if (instrument === 'bell' || instrument === 'crystal' || instrument === 'mallet') {
    const inharmonic = Math.sin(phase * 2.71)
    return (fundamental * 0.52) + (inharmonic * 0.31) + (second * 0.14) + (third * 0.08 * velocity)
  }
  if (instrument === 'wood') {
    return (fundamental * 0.7) + (second * 0.22) + (third * 0.08)
  }
  if (instrument === 'flute') {
    return (fundamental * 0.84) + (second * 0.12) + (third * 0.04)
  }
  return (fundamental * 0.76) + (second * 0.18) + (third * 0.06)
}

const padWave = (phase, instrument) => {
  const fundamental = Math.sin(phase)
  const detuned = Math.sin(phase * 1.003)
  const third = Math.sin(phase * 3)
  if (instrument === 'organ') {
    return (fundamental * 0.56) + (Math.sin(phase * 2) * 0.28) + (third * 0.16)
  }
  if (instrument === 'glass' || instrument === 'airy' || instrument === 'water') {
    return (fundamental * 0.7) + (detuned * 0.22) + (third * 0.08)
  }
  if (instrument === 'drone') {
    return (fundamental * 0.8) + (Math.sin(phase * 0.5) * 0.2)
  }
  return (fundamental * 0.58) + (detuned * 0.3) + (third * 0.12)
}

const addTone = ({ left, right, startFrame, durationFrames, frequency, amplitude, instrument, pan, envelope, vibrato = 0 }) => {
  const endFrame = Math.min(left.length, startFrame + durationFrames)
  const leftGain = Math.cos(((pan + 1) * Math.PI) / 4)
  const rightGain = Math.sin(((pan + 1) * Math.PI) / 4)
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const localFrame = frame - startFrame
    const time = localFrame / SAMPLE_RATE
    const phase = 2 * Math.PI * frequency * time
    const modulation = vibrato === 0 ? 0 : Math.sin(2 * Math.PI * 4.7 * time) * vibrato
    const shapedPhase = phase + modulation
    const signal = waveAt(shapedPhase, instrument, amplitude) * amplitude * envelope(time, durationFrames / SAMPLE_RATE)
    left[frame] = (left[frame] ?? 0) + (signal * leftGain)
    right[frame] = (right[frame] ?? 0) + (signal * rightGain)
  }
}

const addPad = ({ left, right, startFrame, durationFrames, frequency, amplitude, instrument, pan }) => {
  const endFrame = Math.min(left.length, startFrame + durationFrames)
  const noteDuration = durationFrames / SAMPLE_RATE
  const leftGain = Math.cos(((pan + 1) * Math.PI) / 4)
  const rightGain = Math.sin(((pan + 1) * Math.PI) / 4)
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const localFrame = frame - startFrame
    const time = localFrame / SAMPLE_RATE
    const attack = clamp(time / Math.min(0.32, noteDuration * 0.2), 0, 1)
    const release = clamp((noteDuration - time) / Math.min(0.48, noteDuration * 0.25), 0, 1)
    const signal = padWave(2 * Math.PI * frequency * time, instrument) * amplitude * attack * release
    left[frame] = (left[frame] ?? 0) + (signal * leftGain)
    right[frame] = (right[frame] ?? 0) + (signal * rightGain)
  }
}

const addPercussion = ({ left, right, startFrame, durationFrames, kind, amplitude, seed, pan }) => {
  const endFrame = Math.min(left.length, startFrame + durationFrames)
  const leftGain = Math.cos(((pan + 1) * Math.PI) / 4)
  const rightGain = Math.sin(((pan + 1) * Math.PI) / 4)
  const random = createRandom(seed)
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const localTime = (frame - startFrame) / SAMPLE_RATE
    const envelope = Math.exp(-localTime * (kind === 'kick' ? 12 : 29))
    const noise = (random() * 2) - 1
    const frequency = kind === 'kick'
      ? 42 + (48 * envelope)
      : kind === 'pulse' ? 170 : kind === 'drip' ? 520 - (330 * envelope) : kind === 'wood' ? 740 : 1_800
    const tone = Math.sin(2 * Math.PI * frequency * localTime)
    const signal = amplitude * envelope * (
      (kind === 'shaker' ? noise : tone) +
      (kind === 'snare' ? noise * 0.55 : 0) +
      (kind === 'wood' ? Math.sin(2 * Math.PI * frequency * 2.76 * localTime) * 0.28 : 0)
    )
    left[frame] = (left[frame] ?? 0) + (signal * leftGain)
    right[frame] = (right[frame] ?? 0) + (signal * rightGain)
  }
}

const melodyNotes = (scene, random) => {
  const notes = []
  const sequence = [...MELODY_PATTERN]
  const secondary = sequence.map((degree, index) => (degree + (index % 3 === 0 ? 2 : 0)) % scene.mode.length)
  for (let bar = 0; bar < PHRASE_BARS; bar += 1) {
    for (let subdivision = 0; subdivision < 8; subdivision += 1) {
      const phraseIndex = (bar * 2 + Math.floor(subdivision / 2)) % sequence.length
      const rests = subdivision === 3 || (bar % 4 === 3 && subdivision >= 5)
      if (rests || (scene.name === 'end' && subdivision % 4 !== 0)) {
        continue
      }
      const degree = bar < 8 ? (sequence[phraseIndex] ?? 0) : (secondary[phraseIndex] ?? 0)
      const approach = random() > 0.84 ? 1 : 0
      const midi = degreeMidi(scene, degree + approach, 1)
      const beat = (bar * BEATS_PER_BAR) + (subdivision * NOTE_EIGHTH)
      const durationBeats = subdivision % 2 === 0 ? NOTE_EIGHTH * 0.92 : NOTE_EIGHTH * 0.72
      notes.push({ beat, durationBeats, frequency: midiFrequency(midi), pan: ((subdivision % 4) - 1.5) * 0.12 })
    }
  }
  return notes
}

const renderScene = ({ scene, seed }) => {
  const secondsPerBeat = MINUTE_SECONDS / scene.bpm
  const duration = (SONG_BARS * BEATS_PER_BAR * secondsPerBeat)
  const frames = Math.round(duration * SAMPLE_RATE)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const phraseRandom = createRandom(seed)
  const melody = melodyNotes(scene, phraseRandom)
  const fullPhraseDuration = PHRASE_BARS * BEATS_PER_BAR * secondsPerBeat
  const chordBars = PROGRESSION.length

  for (const repetition of [0, 1]) {
    const phraseStart = repetition * fullPhraseDuration
    for (const note of melody) {
      const startTime = phraseStart + (note.beat * secondsPerBeat)
      const startFrame = Math.round(startTime * SAMPLE_RATE)
      const durationFrames = Math.round(note.durationBeats * secondsPerBeat * SAMPLE_RATE)
      const decay = scene.lead === 'bell' || scene.lead === 'crystal' ? 3.4 : scene.lead === 'flute' ? 1.5 : 2.2
      addTone({
        amplitude: 0.14,
        durationFrames,
        envelope: (time, noteDuration) => {
          const attack = clamp(time / 0.012, 0, 1)
          const hold = scene.lead === 'flute' ? 1 : Math.exp(-time * decay)
          const release = clamp((noteDuration - time) / 0.03, 0, 1)
          return attack * hold * release
        },
        frequency: note.frequency,
        instrument: scene.lead,
        left,
        pan: note.pan,
        right,
        startFrame,
        vibrato: scene.lead === 'flute' ? 0.006 : 0,
      })
    }

    for (let bar = 0; bar < PHRASE_BARS; bar += 1) {
      const degree = PROGRESSION[bar % chordBars] ?? 0
      const startTime = phraseStart + (bar * BEATS_PER_BAR * secondsPerBeat)
      const startFrame = Math.round(startTime * SAMPLE_RATE)
      const durationFrames = Math.round((BEATS_PER_BAR * secondsPerBeat) * SAMPLE_RATE)
      for (const [toneIndex, chordOffset] of [0, 2, 4].entries()) {
        const midi = degreeMidi(scene, degree + chordOffset, 0)
        const frequency = midiFrequency(midi)
        addPad({
          amplitude: toneIndex === 0 ? 0.065 : 0.044,
          durationFrames,
          frequency,
          instrument: scene.pad,
          left,
          pan: toneIndex - 1,
          right,
          startFrame,
        })
      }

      const bassMidi = degreeMidi(scene, degree, -1)
      const bassFrequency = midiFrequency(bassMidi)
      for (const beatOffset of [0, 2]) {
        const bassStart = startFrame + Math.round(beatOffset * secondsPerBeat * SAMPLE_RATE)
        const bassLength = Math.round(secondsPerBeat * 0.88 * SAMPLE_RATE)
        addTone({
          amplitude: 0.18,
          durationFrames: bassLength,
          envelope: (time, noteDuration) => Math.exp(-time * 2.6) * clamp((noteDuration - time) / 0.06, 0, 1),
          frequency: beatOffset === 0 ? bassFrequency : bassFrequency * 1.5,
          instrument: 'wood',
          left,
          pan: 0,
          right,
          startFrame: bassStart,
        })
      }

      if (scene.percussion !== 'none') {
        for (const beatOffset of [0, 2]) {
          const percussionStart = startFrame + Math.round(beatOffset * secondsPerBeat * SAMPLE_RATE)
          const type = scene.percussion === 'drums'
            ? 'kick'
            : scene.percussion === 'pulse' ? 'pulse' : scene.percussion === 'drip' ? 'drip' : scene.percussion === 'woodblock' ? 'wood' : 'shaker'
          addPercussion({
            amplitude: type === 'kick' ? 0.16 : 0.04,
            durationFrames: Math.round(SAMPLE_RATE * 0.14),
            kind: type,
            left,
            pan: beatOffset === 0 ? -0.1 : 0.1,
            right,
              seed: seed ^ Math.imul(bar, 0x45d9f3b),
            startFrame: percussionStart,
          })
        }
        if (scene.percussion === 'drums' || scene.percussion === 'shaker' || scene.percussion === 'woodblock') {
          for (const beatOffset of [1, 3]) {
            const percussionStart = startFrame + Math.round(beatOffset * secondsPerBeat * SAMPLE_RATE)
            addPercussion({
              amplitude: 0.045,
              durationFrames: Math.round(SAMPLE_RATE * 0.09),
              kind: scene.percussion === 'drums' ? 'snare' : scene.percussion === 'woodblock' ? 'wood' : 'shaker',
              left,
              pan: beatOffset === 1 ? -0.22 : 0.22,
              right,
              seed: seed ^ Math.imul(bar + beatOffset, 0x27d4eb2d),
              startFrame: percussionStart,
            })
          }
        }
      }
    }
  }
  return { duration, frames, left, right }
}

const writePcm = async ({ frames, left, right, rawPath }) => {
  const raw = await open(rawPath, 'w')
  let sumSquares = 0
  let peak = 0
  try {
    for (let firstFrame = 0; firstFrame < frames; firstFrame += BLOCK_FRAMES) {
      const blockFrames = Math.min(BLOCK_FRAMES, frames - firstFrame)
      const block = Buffer.allocUnsafe(blockFrames * CHANNELS * 2)
      for (let index = 0; index < blockFrames; index += 1) {
        const frame = firstFrame + index
        const leftValue = left[frame] ?? 0
        const rightValue = right[frame] ?? 0
        const absolutePeak = Math.max(Math.abs(leftValue), Math.abs(rightValue))
        peak = Math.max(peak, absolutePeak)
        sumSquares += (leftValue * leftValue) + (rightValue * rightValue)
        const byteOffset = index * CHANNELS * 2
        block.writeInt16LE(Math.round(clamp(leftValue, -1, 1) * 32_767), byteOffset)
        block.writeInt16LE(Math.round(clamp(rightValue, -1, 1) * 32_767), byteOffset + 2)
      }
      await raw.write(block)
    }
  } finally {
    await raw.close()
  }
  const rms = Math.sqrt(sumSquares / (frames * CHANNELS))
  if (!Number.isFinite(rms) || rms <= 0 || peak <= 0) {
    throw new Error('Cannot normalize silent or invalid PCM output')
  }
  const targetGain = TARGET_RMS / rms
  const peakGain = PEAK_LIMIT / peak
  const normalization = Math.min(targetGain, peakGain)
  return {
    normalization,
    normalizedPeak: peak * normalization,
    normalizedRms: rms * normalization,
    peakLimited: peakGain < targetGain,
  }
}

const encodeOggBatch = (records) => {
  const inputArgs = records.flatMap(({ rawPath }) => [
    '-f',
    's16le',
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    String(CHANNELS),
    '-i',
    rawPath,
  ])
  const filters = records.map(({ normalization }, index) =>
    `[${index}:a]volume=${normalization.toFixed(10)}[audio${index}]`,
  ).join(';')
  const outputArgs = records.flatMap((record, index) => [
    '-map',
    `[audio${index}]`,
    '-c:a',
    'libvorbis',
    '-b:a',
    ENCODE_BITRATE,
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    String(CHANNELS),
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-y',
    record.outputPath,
  ])
  const args = [
    'run',
    'nixpkgs#ffmpeg',
    '--',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    ...inputArgs,
    '-filter_complex',
    filters,
    ...outputArgs,
  ]
  const result = spawnSync('nix', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${result.stderr.trim()}`)
  }
}

const measureEncodedBatch = (records) => {
  const inputArgs = records.flatMap(({ outputPath }) => ['-i', outputPath])
  const filters = records.map((_, index) => `[${index}:a]volumedetect@asset${index}[volume${index}]`).join(';')
  const outputArgs = records.flatMap((_, index) => ['-map', `[volume${index}]`, '-f', 'null', '-'])
  const result = spawnSync('nix', [
    'run',
    'nixpkgs#ffmpeg',
    '--',
    '-hide_banner',
    '-nostats',
    ...inputArgs,
    '-filter_complex',
    filters,
    ...outputArgs,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error !== undefined) {
    throw result.error
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (result.status !== 0) {
    throw new Error(`ffmpeg analysis failed (${result.status}): ${result.stderr.trim()}`)
  }
  const measurements = new Map()
  for (const match of output.matchAll(/\[volumedetect@asset(?<index>\d+) @ [^\]]+\] mean_volume:\s*(?<value>-?[\d.]+) dB/gu)) {
    const index = Number(match.groups?.['index'])
    const loudnessDbfs = Number(match.groups?.['value'])
    measurements.set(index, { loudnessDbfs, peakDbfs: Number.NaN })
  }
  for (const match of output.matchAll(/\[volumedetect@asset(?<index>\d+) @ [^\]]+\] max_volume:\s*(?<value>-?[\d.]+) dB/gu)) {
    const index = Number(match.groups?.['index'])
    const measurement = measurements.get(index)
    if (measurement !== undefined) {
      measurement.peakDbfs = Number(match.groups?.['value'])
    }
  }
  if (measurements.size !== records.length) {
    throw new Error(`ffmpeg did not report loudness and peak for all ${records.length} files`)
  }
  return records.map((record, index) => {
    const measurement = measurements.get(index)
    if (measurement === undefined || !Number.isFinite(measurement.peakDbfs)) {
      throw new Error(`ffmpeg measurement is missing for ${record.outputPath}`)
    }
    return measurement
  })
}

const recalibrateBatch = (records, measurements) => {
  const changed = []
  for (const [index, record] of records.entries()) {
    const measured = measurements[index]
    if (measured === undefined) {
      throw new Error(`ffmpeg measurement is missing for ${record.outputPath}`)
    }
    const loudnessCorrectionDb = -18 - measured.loudnessDbfs
    const peakRoomDb = -1.2 - measured.peakDbfs
    const correctionDb = Math.min(loudnessCorrectionDb, peakRoomDb)
    record.peakLimited = correctionDb < loudnessCorrectionDb
    if (Math.abs(correctionDb) >= 0.03) {
      record.normalization *= dbToLinear(correctionDb)
      changed.push(record)
    }
  }
  return changed
}

const prepareAudio = async ({ audio, rawPath, outputPath, root }) => {
  const stats = await writePcm({ ...audio, rawPath })
  await mkdir(dirname(outputPath), { recursive: true })
  return {
    normalization: stats.normalization,
    outputPath,
    path: outputPath.slice(root.length + 1),
    peakLimited: stats.peakLimited,
    rawPath,
  }
}

const printHelp = () => {
  process.stdout.write([
    'Generate reproducible procedural audio assets.',
    '',
    'Usage: node scripts/audio/generate-assets.mjs [options]',
    '  --output-dir <path>  Output root (default: current directory)',
    '  --seed <uint32>      Deterministic seed (default: 482712)',
    '  --only-cue <id>      Generate one cue for a small determinism check',
    '  --only-scene <name>  Generate one music scene',
    '  --help               Show this help',
    '',
  ].join('\n'))
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const root = resolve(options.outputDir)
  const cues = options.cueId !== null
    ? CUES.filter(({ id }) => id === options.cueId)
    : options.scene === null ? CUES : []
  const scenes = options.scene !== null
    ? SCENES.filter(({ name }) => name === options.scene)
    : options.cueId === null ? SCENES : []
  const tempPath = await mkdtemp(join(tmpdir(), 'mc-audio-render-'))
  try {
    const records = []
    for (const cue of cues) {
      const index = CUES.findIndex(({ id }) => id === cue.id)
      const seed = (options.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
      const audio = addCue({ ...cue, seed })
      const outputPath = join(root, 'audio', 'effects', 'generated', `${cue.id}.ogg`)
      const rawPath = join(tempPath, `cue-${String(index).padStart(2, '0')}.s16le`)
      const prepared = await prepareAudio({ audio, outputPath, rawPath, root })
      records.push({ ...prepared, category: 'effects', durationSeconds: audio.frames / SAMPLE_RATE, name: cue.id })
    }
    for (const scene of scenes) {
      const index = SCENES.findIndex(({ name }) => name === scene.name)
      const seed = (options.seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0
      const audio = renderScene({ scene, seed })
      const outputPath = join(root, 'audio', 'music', `${scene.name}.ogg`)
      const rawPath = join(tempPath, `scene-${String(index).padStart(2, '0')}.s16le`)
      const prepared = await prepareAudio({ audio, outputPath, rawPath, root })
      records.push({ ...prepared, category: 'music', durationSeconds: audio.frames / SAMPLE_RATE, scene, seed })
    }

    encodeOggBatch(records)
    let measured = measureEncodedBatch(records)
    const recalibrated = recalibrateBatch(records, measured)
    if (recalibrated.length > 0) {
      encodeOggBatch(recalibrated)
      const correctedMeasurements = measureEncodedBatch(recalibrated)
      const measurementsByPath = new Map(recalibrated.map(({ outputPath }, index) => [
        outputPath,
        correctedMeasurements[index],
      ]))
      measured = records.map((record, index) => measurementsByPath.get(record.outputPath) ?? measured[index])
    }
    for (const [index, record] of records.entries()) {
      const measurement = measured[index]
      if (measurement === undefined) {
        throw new Error(`ffmpeg measurement is missing for ${record.outputPath}`)
      }
      if (measurement.peakDbfs > -1) {
        throw new Error(`encoded sample peak exceeds -1 dBFS for ${record.outputPath}: ${measurement.peakDbfs} dBFS`)
      }
      if (!record.peakLimited && Math.abs(measurement.loudnessDbfs + 18) > 0.25) {
        throw new Error(`encoded RMS is outside the -18 dBFS target for ${record.outputPath}: ${measurement.loudnessDbfs} dBFS`)
      }
    }
    const sizes = await Promise.all(records.map(async ({ outputPath }) => (await stat(outputPath)).size))
    const created = records.map((record, index) => ({
      ...record,
      ...measured[index],
      bytes: sizes[index] ?? 0,
    }))

    const musicRecords = created.filter(({ category }) => category === 'music')
    if (musicRecords.length > 0) {
      const sceneMetadata = Object.fromEntries(musicRecords.map((record) => [record.scene.name, {
        durationSeconds: record.durationSeconds,
        key: record.scene.key,
        tempoBpm: record.scene.bpm,
        timbre: record.scene.timbre,
      }]))
      const metadata = {
        codec: 'Vorbis',
        container: 'Ogg',
        sampleRateHz: SAMPLE_RATE,
        channels: CHANNELS,
        seed: options.seed,
        normalization: { targetDbfsRms: -18, maximumPeakDbfs: -1 },
        scenes: sceneMetadata,
      }
      const metadataPath = join(root, 'audio', 'music', 'metadata.json')
      await mkdir(dirname(metadataPath), { recursive: true })
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    }

    for (const record of created) {
      const musicMetadata = record.category === 'music'
        ? `\t${record.durationSeconds.toFixed(4)} seconds\t${record.scene.key}\t${record.scene.bpm} BPM`
        : ''
      const peakLimited = record.peakLimited ? '\tpeak ceiling limited RMS' : ''
      process.stdout.write(`${record.path}\t${record.bytes} bytes\t${record.loudnessDbfs.toFixed(2)} dBFS RMS\tpeak ${record.peakDbfs.toFixed(2)} dBFS${peakLimited}${musicMetadata}\n`)
    }
    if (options.cueId === null && options.scene === null) {
      const effectBytes = created.filter(({ category }) => category === 'effects').reduce((sum, record) => sum + record.bytes, 0)
      const musicBytes = created.filter(({ category }) => category === 'music').reduce((sum, record) => sum + record.bytes, 0)
      process.stdout.write(`Effects: ${effectBytes} bytes; music: ${musicBytes} bytes; target ${20 * Math.log10(TARGET_RMS)} dBFS RMS\n`)
    }
  } finally {
    await rm(tempPath, { recursive: true, force: true })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
