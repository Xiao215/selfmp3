/**
 * The page half of spike check 2.
 *
 * It drives the repository's own `apps/app/src/ports/engine.web.ts`, bundled
 * next to this file by the runner — not a copy of it. The engine imports only
 * types from `@selfmp3/client`, so esbuild can take it on its own, and that is
 * the whole reason this check is worth anything: what plays here is what plays
 * in the app.
 */
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(predicate, { timeoutMs = 20_000, everyMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(everyMs)
  }
  return false
}

window.__spike = async () => {
  const probe = document.createElement('audio')
  const codecs = {
    aac: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    mp3: probe.canPlayType('audio/mpeg'),
    wav: probe.canPlayType('audio/wav'),
    flac: probe.canPlayType('audio/flac'),
  }

  const engine = new window.SpikeEngine.AudioEngine()
  engine.streamUrl = id => `app://selfmp3/_media/songs/${id}.wav`
  engine.nextTrackId = () => (engine.currentSongId === 1 ? 2 : null)
  engine.configure({ crossfadeSeconds: 1, gapless: true })

  const out = { codecs, capabilities: engine.capabilities, errors: [], trace: [] }
  let last = null
  engine.subscribe(state => {
    const flags = `${state.playing ? 'play' : 'pause'}/${state.stalled ? 'stalled' : 'ready'}`
    if (flags !== last) {
      last = flags
      out.trace.push(`${flags}@${state.currentTime.toFixed(2)}`)
    }
  })

  // The analyser is asked for before anything plays, the way a visual does.
  const analyser = engine.analyser()
  out.analyserMade = Boolean(analyser)

  await engine.load(1, { autoplay: true })
  out.playing = await until(() => engine.state.playing && engine.state.currentTime > 0.4)
  out.afterPlay = { ...engine.state }
  if (engine.state.error) out.errors.push(engine.state.error)

  // Samples only reach the analyser if the element's CORS mode was satisfied;
  // `use-credentials` against `*` would leave the graph silent and the bins
  // flat, which is the failure this check exists to catch.
  let peak = 0
  if (analyser) {
    const bins = new Uint8Array(analyser.frequencyBinCount)
    for (let attempt = 0; attempt < 60 && peak === 0; attempt += 1) {
      analyser.getByteFrequencyData(bins)
      peak = Math.max(...bins)
      if (peak === 0) await wait(100)
    }
  }
  out.analyserPeak = peak

  // A seek far past what is buffered, so Chromium has to ask for a fresh range.
  const duration = engine.state.duration
  out.duration = duration
  engine.seek(duration - 12)
  out.seeked = await until(() => engine.state.currentTime > duration - 13 && engine.state.currentTime < duration - 5)
  out.afterSeek = engine.state.currentTime

  // Into the crossfade window: the handover should put song 2 on without a gap.
  engine.seek(duration - 1.4)
  out.crossfaded = await until(() => engine.currentSongId === 2, { timeoutMs: 15_000 })
  // Audible progress, read from the element rather than from the state flag,
  // because the flag is the thing in question here.
  const wasAt = engine.state.currentTime
  await wait(600)
  out.stillAdvancing = engine.state.currentTime > wasAt
  out.playingFlagSurvived = engine.state.playing
  out.afterCrossfade = { songId: engine.currentSongId, playing: engine.state.playing, t: engine.state.currentTime }

  engine.setRate(1.25)
  engine.setPreservesPitch(true)
  out.rate = engine.state.rate
  out.preservesPitch = engine.state.preservesPitch

  engine.destroy()
  return out
}
