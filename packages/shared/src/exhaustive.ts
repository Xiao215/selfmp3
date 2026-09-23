/**
 * The end of an exhaustive `switch`: `default: return assertNever(value)`.
 *
 * A trailing `throw` after a switch satisfies the return type whatever the
 * switch covers, so it cannot tell the compiler anything. This can: the
 * argument only types as `never` once every member of the union has a case,
 * so adding a variant to a schema stops the file compiling until it is handled.
 */
export function assertNever(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}
