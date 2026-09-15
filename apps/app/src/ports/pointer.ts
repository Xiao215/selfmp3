/**
 * Whether the primary pointer is a fine one — a mouse or a trackpad.
 *
 * A phone or a tablet is a finger, so this is false everywhere native. The web
 * half, `pointer.web.ts`, asks the browser. The shell uses it to decide how
 * densely to draw controls at desktop width: this app's buttons are sized
 * for a mouse, and an iPad held at that width still wants a finger's.
 */
export const finePointer = false
