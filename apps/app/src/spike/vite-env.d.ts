/**
 * Types for the Vite variables `apps/web` reads.
 *
 * The spike imports `apps/web/src/player/engine.ts` unchanged, which reaches
 * `apps/web/src/lib/platform.ts`, which reads `import.meta.env` — Vite's, and
 * declared by `vite/client` in the web app's own tsconfig. This app has no Vite,
 * so `tsc` here has never heard of it and the borrowed file fails to compile.
 *
 * This declaration is the spike's way of borrowing the file anyway. It is not
 * the answer: phase 1 moves that code into `packages/client` and it reads
 * `process.env.EXPO_PUBLIC_*`, which Expo inlines on every platform and tsc
 * already knows. When that lands, this file goes.
 */
interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly PROD: boolean
  readonly [key: string]: string | boolean | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
