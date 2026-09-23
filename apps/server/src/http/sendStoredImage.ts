import fs from 'node:fs'
import type { Request, Response } from 'express'

/**
 * A file the server keeps as an image — a cover, an artist's picture — sent
 * with a conditional GET, so a tab that has it asks once a week and gets a
 * 304 in between.
 *
 * The etag is the file's size and mtime; a new file under the same name is a
 * new etag. Awaited, because `sendFile` is asynchronous: returning before it
 * is done would let the route wrapper see `headersSent === false` and send a
 * 204 on top of the image.
 *
 * `dotfiles: 'allow'` because the path is the server's own, never the
 * request's, and `send` otherwise answers 404 for any path with a dot-segment
 * in it — so a data directory under `~/.local/share` (the Linux default) or
 * any other hidden folder served no images at all.
 *
 * The caching headers go through `headers`, which Express sets only once the
 * file is really being sent. Set up front, a send that failed went out with a
 * week's max-age, and the app's cache went on serving itself that failure in
 * place of the image long after the server had it.
 */
export async function sendStoredImage(
  req: Request,
  res: Response,
  image: { readonly path: string; readonly contentType: string },
): Promise<void> {
  const stat = fs.statSync(image.path)
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const caching = {
    'Content-Type': image.contentType,
    ETag: etag,
    'Cache-Control': 'private, max-age=604800',
  }

  if (req.headers['if-none-match'] === etag) {
    res.set(caching).status(304).end()
    return
  }

  await new Promise<void>((resolve, reject) => {
    res.sendFile(image.path, { dotfiles: 'allow', headers: caching }, error =>
      error ? reject(error) : resolve(),
    )
  })
}
