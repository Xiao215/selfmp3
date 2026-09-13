/**
 * The service worker, on a phone: there is none. The app is installed, its
 * shell is the binary, and downloads are files (src/ports/downloadStorage.ts).
 */
export function registerServiceWorker(_options: { cloud: boolean }): void {}
