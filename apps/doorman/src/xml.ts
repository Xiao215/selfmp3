/**
 * Reading the bucket's XML without an XML parser.
 *
 * Workers have no DOMParser, and the only two answers the doorman reads — a
 * ListObjectsV2 page and an error — are small, flat and written by a machine.
 * So this picks out the few elements it needs by name.
 *
 * That is safe with patterns because XML escapes `<` and `&` inside text: a
 * key containing `</Key>` arrives as `&lt;/Key&gt;`, so an element's text
 * never contains `<` and cannot end the element early. Every text is
 * unescaped exactly once, after it has been cut out.
 */

interface ListingPage {
  readonly objects: ReadonlyArray<{ readonly key: string; readonly size: number }>
  readonly truncated: boolean
  readonly nextToken: string | null
}

const CONTENTS = /<Contents>([\s\S]*?)<\/Contents>/g

/** One page of a ListObjectsV2 answer, or null when the XML is not one. */
export function parseListing(xml: string): ListingPage | null {
  if (!/<ListBucketResult[\s>]/.test(xml)) return null

  const objects: Array<{ key: string; size: number }> = []
  for (const match of xml.matchAll(CONTENTS)) {
    const block = match[1] ?? ''
    const key = element(block, 'Key')
    if (key === null) continue
    const size = Number(element(block, 'Size') ?? '0')
    objects.push({ key, size: Number.isSafeInteger(size) && size >= 0 ? size : 0 })
  }

  // The page's own fields, looked for only outside the objects' blocks.
  const rest = xml.replace(CONTENTS, '')
  return {
    objects,
    truncated: element(rest, 'IsTruncated')?.trim() === 'true',
    nextToken: element(rest, 'NextContinuationToken'),
  }
}

/** `<Error><Code>NoSuchBucket</Code><Message>…</Message></Error>` */
export function parseError(xml: string): { code: string | null; message: string | null } {
  if (!/<Error[\s>]/.test(xml)) return { code: null, message: null }
  return { code: element(xml, 'Code')?.trim() || null, message: element(xml, 'Message') }
}

const patterns = new Map<string, RegExp>()

function element(xml: string, name: string): string | null {
  let pattern = patterns.get(name)
  if (!pattern) {
    pattern = new RegExp(`<${name}>([^<]*)</${name}>`)
    patterns.set(name, pattern)
  }
  const text = pattern.exec(xml)?.[1]
  return text === undefined ? null : unescapeXml(text)
}

const ENTITY = /&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** The five named entities and numeric character references. Anything else stays as it is. */
export function unescapeXml(text: string): string {
  return text.replace(
    ENTITY,
    (whole, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (name) return NAMED[name] ?? whole
      const code = hex ? parseInt(hex, 16) : Number(decimal)
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      return valid ? String.fromCodePoint(code) : whole
    },
  )
}
