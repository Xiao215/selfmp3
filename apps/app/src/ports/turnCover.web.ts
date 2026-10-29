import type { Size } from '../shell/layoutSize.model'

/** A browser window is resized, not turned under a frame already drawn: nothing to cover. */
export function useTurnCover(_size: Size, _ground: string): void {}
