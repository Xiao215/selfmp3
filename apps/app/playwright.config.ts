// The real configuration lives in verify/, beside the specs it describes.
// This file exists so that `npx playwright test verify/…` from apps/app finds
// it without a `--config` flag, which is how the gates in docs/UNIVERSAL.md
// spell those commands.
export { default } from './verify/playwright.config'
