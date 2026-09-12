/**
 * The library route.
 *
 * A route file renders a feature and does nothing else — `docs/UNIVERSAL.md`'s
 * layout for `apps/app`. The screen and everything it knows live in
 * `src/features/library/`, which is also where its model and that model's tests
 * are, so a feature is one folder rather than a screen here and its logic
 * somewhere else.
 */
export { LibraryScreen as default } from '../src/features/library/LibraryScreen'
