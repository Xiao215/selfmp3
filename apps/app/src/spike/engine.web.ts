// The web half of the spike's engine pair.
//
// Re-exports apps/web's engine untouched. Check 4 asks whether it runs inside
// the Metro web build *unchanged*, so this file adds nothing but a name.
export { AudioEngine } from '../../../web/src/player/engine'
export type { EngineState, RepeatMode } from '../../../web/src/player/engine'
