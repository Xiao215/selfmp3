import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { z } from 'zod'

/**
 * A typed route wrapper.
 *
 * Express handlers are `any` by default, which quietly undoes most of the
 * benefit of TypeScript at exactly the place untrusted data enters. This wraps
 * a handler with zod schemas for params, query and body, so inside the handler
 * every input is both validated and correctly typed — and an async throw is
 * forwarded to the error middleware instead of becoming an unhandled rejection.
 *
 * The generics are over the *schemas* rather than over bare `Params`/`Query`/
 * `Body` types. Writing `params?: z.ZodType<Params>` looks equivalent but is
 * not: that form is `ZodType<Params, ZodTypeDef, Params>`, so TypeScript is
 * free to infer from the schema's *input* type. For any schema that uses
 * `.default()` or `.transform()` — which is most of the query schemas here —
 * the input type still has the raw, pre-parse shape. A handler would then see
 * `refresh: string | boolean | undefined` when the whole point of parsing is
 * that it is a `boolean` by the time the handler runs.
 *
 * Deriving from `z.output<S>` pins it to the parsed side, which is the only
 * side a handler ever sees.
 */

/** The parsed type of a schema, or a fallback when no schema was supplied. */
type Parsed<S, Fallback> = S extends z.ZodTypeAny ? z.output<S> : Fallback

export interface RouteContext<Params, Query, Body> {
  readonly params: Params
  readonly query: Query
  readonly body: Body
  readonly req: Request
  readonly res: Response
}

/**
 * Build an Express handler from schemas plus a typed function.
 *
 * Returning a value sends it as JSON. Returning `undefined` means the handler
 * took care of the response itself (streaming, redirects, 204s).
 */
export function route<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
>(
  schemas: { readonly params?: P; readonly query?: Q; readonly body?: B },
  handler: (
    context: RouteContext<
      Parsed<P, Record<string, string>>,
      Parsed<Q, Record<string, unknown>>,
      Parsed<B, unknown>
    >,
  ) => unknown,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const params = (schemas.params ? schemas.params.parse(req.params) : req.params) as Parsed<
          P,
          Record<string, string>
        >

        const query = (schemas.query ? schemas.query.parse(req.query) : req.query) as Parsed<
          Q,
          Record<string, unknown>
        >

        const body = (schemas.body ? schemas.body.parse(req.body) : req.body) as Parsed<B, unknown>

        const result = await handler({ params, query, body, req, res })

        if (res.headersSent) return
        if (result === undefined) {
          res.status(204).end()
          return
        }
        res.json(result)
      } catch (error) {
        next(error)
      }
    })()
  }
}
