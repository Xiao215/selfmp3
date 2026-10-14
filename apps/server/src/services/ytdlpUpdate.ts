import fs from 'node:fs'

/**
 * How to get a newer yt-dlp, which depends on where the server runs.
 *
 * In the Docker image there is no brew and the binary is baked in: the image
 * gets a fresh yt-dlp every week (.github/workflows/docker.yml), so the fix
 * there is pulling the newer image. Said wherever a stale yt-dlp is the likely
 * cause — `selfmp3 doctor` and a download YouTube refused (ytCookies.ts).
 */
export const YTDLP_UPDATE_HINT = fs.existsSync('/.dockerenv')
  ? 'docker compose pull && docker compose up -d'
  : 'brew upgrade yt-dlp'
