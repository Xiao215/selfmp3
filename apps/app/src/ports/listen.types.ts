/** What a preview is doing, read from the audio rather than from which event fired. */
export type ListenStatus = 'loading' | 'playing' | 'paused' | 'error'

export interface ListenAudio {
  /** Load a track and play it. */
  play(src: string): void
  /** Carry on with what is loaded, or try it again after an error. */
  resume(): void
  pause(): void
  seek(seconds: number): void
  /** Stop and let go of the track. */
  stop(): void
  /** Every change, with the element's own idea of where it is. */
  subscribe(listener: (state: ListenState) => void): () => void
  dispose(): void
}

export interface ListenState {
  readonly status: ListenStatus
  readonly currentTime: number
  /** NaN until the audio knows. */
  readonly duration: number
}
