/**
 * The handful of globals this package uses that are in no `lib` it loads.
 *
 * The tsconfig omits `DOM` on purpose — a reach for `window` or `caches` must
 * not compile, because React Native has neither. But that also takes away
 * timers and `URL`, which are not the DOM's: every runtime this package will
 * ever see has them, Node and Hermes included.
 *
 * They were resolving by accident, from whatever `@types` packages happened to
 * be visible in `node_modules`. That is not a promise, and it stopped being
 * true the moment the dependency tree moved — which is how a package that had
 * always compiled suddenly could not find `setTimeout`. Declared here, it is a
 * promise, and a narrow one: only what is used, only what is portable.
 */

declare function setTimeout(handler: () => void, timeout?: number): number
declare function clearTimeout(id: number | undefined): void

declare class URL {
  constructor(url: string, base?: string)
  readonly pathname: string
  readonly search: string
  readonly origin: string
  toString(): string
}
