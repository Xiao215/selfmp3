/** The browser's own answer: a mouse or trackpad is `(pointer: fine)`. */
export const finePointer: boolean =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches
