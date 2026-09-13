/**
 * Being told the person is still there: a pointer moving, a key pressed.
 *
 * Only a computer's Focus page asks, to tuck its controls away while nobody is
 * touching anything. A phone has no pointer to go still, so nothing is ever
 * reported and nothing ever hides.
 */
export function onUserActivity(_listener: () => void): () => void {
  return () => undefined
}
