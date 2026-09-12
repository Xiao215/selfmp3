/**
 * Spike harness for check 4: does the existing web audio engine run inside the
 * Metro web build, unchanged?
 *
 * "Unchanged" is the whole point, so `apps/web/src/player/engine.ts` is
 * imported by relative path and not copied, edited or wrapped. If Metro and
 * `react-native-web` can bundle it as it stands, the web side of the
 * PlaybackEngine port is a move in phase 3 rather than a rewrite.
 *
 * The engine itself is reached through `src/spike/engine.{web,native}.ts` — the
 * `.web` / `.native` pair foundation 2 gives every port — so the native bundle
 * never sees `HTMLAudioElement`. It is spike scaffolding on a throwaway branch
 * and is not part of the app; nothing links to it.
 */
import { useEffect } from 'react'
import { Text, View } from 'react-native'

import { AudioEngine } from '../src/spike/engine'

/** The two tones verify/server.mjs serves, keyed by the song ids used here. */
const TONES: Record<number, string> = {
  1: '/fixtures/tone-a.wav',
  2: '/fixtures/tone-b.wav',
}

type Engine = InstanceType<typeof AudioEngine>

declare global {
  // `var` is required here: only a `var` declaration merges onto `globalThis`,
  // which is how the Playwright specs reach these.
  var __spikeEngine: Engine | undefined
  var __spikeEvents: string[] | undefined
  var __spikeAudio: HTMLAudioElement[] | undefined
}

export default function SpikeEngine() {
  useEffect(() => {
    // The engine builds its two elements with `new Audio()` and never puts them
    // in the document — it has no reason to. So the test cannot find them with
    // a selector, and the constructor is wrapped instead to collect them. This
    // is how the spike observes the handover: gapless and crossfade are both
    // claims about two elements at once, and `engine.state` only describes one.
    const made: HTMLAudioElement[] = []
    const RealAudio = window.Audio
    window.Audio = function SpyAudio(...args: unknown[]) {
      const element = new (RealAudio as unknown as new (...a: unknown[]) => HTMLAudioElement)(
        ...args,
      )
      made.push(element)
      return element
    } as unknown as typeof window.Audio

    const engine = new AudioEngine()
    window.Audio = RealAudio
    globalThis.__spikeAudio = made

    const events: string[] = []

    // The provider normally supplies these three; the spike supplies tones.
    engine.streamUrl = (songId) => TONES[songId] ?? ''
    engine.nextTrackId = () => 2
    engine.onTrackEnd = () => {
      events.push('trackEnd')
    }

    // No state and no re-render: the test waits for `__spikeEngine` itself
    // rather than for a label to change. A `setReady` here would be a setState
    // in an effect body, which React 19 rightly complains about, and the label
    // never told the test anything the global did not.
    globalThis.__spikeEngine = engine
    globalThis.__spikeEvents = events

    return () => {
      engine.destroy()
      globalThis.__spikeEngine = undefined
      globalThis.__spikeAudio = undefined
    }
  }, [])

  return (
    <View>
      <Text testID="spike-engine-status">engine harness</Text>
    </View>
  )
}
