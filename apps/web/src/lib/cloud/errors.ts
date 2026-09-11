/** A cloud route that fails: status 0 reads as "offline" to the rest of the app. */
export class CloudRouteError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'CloudRouteError'
    this.status = status
    this.code = code
  }
}

export function notFound(what: string): CloudRouteError {
  return new CloudRouteError(404, `no such ${what}`, 'not_found')
}
