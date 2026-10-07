import { createValueStore } from '../state/valueStore.model'

/**
 * Whether Now Playing's Focus page has gone still.
 *
 * The page knows when the mouse has stopped; the shell owns the player bar. In
 * Focus with a still mouse the bar folds away under the page and comes back
 * the moment anything moves, so the page says so here and the shell
 * listens.
 */
const idle = createValueStore(false)

export const setStageIdle = idle.set
export const subscribeStageIdle = idle.subscribe
export const stageIdle = idle.get
