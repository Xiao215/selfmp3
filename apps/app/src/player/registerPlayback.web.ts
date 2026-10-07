/**
 * Nothing to register in a browser: playback is the `<audio>` engine behind
 * `ports/engine.web.ts`, and the media keys are its media session's. The
 * phone's half hands track-player its playback service.
 */
export function registerPlayback(): void {}
