// The default half of the spike's engine pair, which on a phone is the one that
// runs.
//
// Note the filename, because it is a rule phase 3 needs: the pair is
// `engine.ts` + `engine.web.ts`, NOT `engine.native.ts` + `engine.web.ts`.
// Metro resolves either, but `tsc` only understands the first — given two
// platform-suffixed files and no plain one it reports "Cannot find module", so
// a port written the second way typechecks red forever while working fine at
// runtime. The plain file is the native one; `.web.ts` overrides it.
//
// The second half of the same rule: whichever file tsc picks is the one that
// supplies the *type* for every caller, so the two halves have to agree on a
// shape or the app typechecks against the wrong one. Here that shape is
// borrowed from the web engine with a type-only import, which erases at build
// time and so never drags `HTMLAudioElement` into the native bundle. Phase 3
// replaces the borrowing with the real thing: `PlaybackEngine` declared in
// `packages/client`, with both sides implementing it.
import type { AudioEngine as WebAudioEngine } from '../../../web/src/player/engine'

/**
 * The web engine drives two `<audio>` elements, which do not exist on a phone.
 * Reaching this is a bug, so it says so rather than failing quietly — on the
 * phone, playback belongs to track-player.
 */
class NativeAudioEngine {
  constructor() {
    throw new Error(
      'The web AudioEngine is not the native engine. On a phone, playback ' +
        'belongs to track-player behind the PlaybackEngine port.',
    )
  }
}

export const AudioEngine = NativeAudioEngine as unknown as new () => WebAudioEngine

export type { EngineState, RepeatMode } from '../../../web/src/player/engine'
