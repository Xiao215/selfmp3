/**
 * A yes or no that touch handlers set and a gesture reads, outside React's
 * drawing: whether the finger now down came down on the words, on Now
 * Playing's phone page and a share link's.
 */
export class TouchFlag {
  #on = false
  set(on: boolean): void {
    this.#on = on
  }
  on(): boolean {
    return this.#on
  }
}
