export type ParsedCgvBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3
      text: string
    }
  | {
      type: 'paragraph'
      text: string
    }
  | {
      type: 'list'
      ordered: boolean
      items: string[]
    }

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function decodeHtmlEntities(input: string): string {
  let output = input

  for (const [entity, value] of Object.entries(NAMED_ENTITIES)) {
    output = output.split(entity).join(value)
  }

  output = output.replace(/&#(\d+);/g, (_, code) => {
    const value = Number.parseInt(code, 10)
    return Number.isFinite(value) ? String.fromCodePoint(value) : ''
  })

  output = output.replace(/&#x([0-9a-fA-F]+);/g, (_, hexCode) => {
    const value = Number.parseInt(hexCode, 16)
    return Number.isFinite(value) ? String.fromCodePoint(value) : ''
  })

  return output
}

function cleanInlineContent(input: string): string {
  const withLineBreaks = input.replace(/<br\s*\/?>/gi, '\n')
  const withoutTags = withLineBreaks.replace(/<\/?[^>]+>/g, '')
  const decoded = decodeHtmlEntities(withoutTags)

  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function fallbackToParagraphBlocks(input: string): ParsedCgvBlock[] {
  const plainText = cleanInlineContent(
    input
      .replace(/<\/(p|div|h1|h2|h3|li|ul|ol)>/gi, '\n')
      .replace(/<(p|div|h1|h2|h3|li|ul|ol)[^>]*>/gi, '\n')
  )

  return plainText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: 'paragraph',
      text: paragraph,
    }))
}

export function parseCgvHtml(html: string | null | undefined): ParsedCgvBlock[] {
  if (!html || !html.trim()) {
    return []
  }

  const sanitizedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\r\n?/g, '\n')

  const blocks: ParsedCgvBlock[] = []
  const blockRegex = /<(h[1-3]|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi

  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRegex.exec(sanitizedHtml)) !== null) {
    const tagName = blockMatch[1]?.toLowerCase()
    const innerHtml = blockMatch[2] || ''

    if (!tagName) {
      continue
    }

    if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
      const text = cleanInlineContent(innerHtml)
      if (!text) {
        continue
      }

      blocks.push({
        type: 'heading',
        level: Number.parseInt(tagName.charAt(1), 10) as 1 | 2 | 3,
        text,
      })
      continue
    }

    if (tagName === 'p') {
      const text = cleanInlineContent(innerHtml)
      if (!text) {
        continue
      }

      blocks.push({
        type: 'paragraph',
        text,
      })
      continue
    }

    const ordered = tagName === 'ol'
    const items: string[] = []
    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi
    let liMatch: RegExpExecArray | null

    while ((liMatch = liRegex.exec(innerHtml)) !== null) {
      const itemText = cleanInlineContent(liMatch[1] || '')
      if (itemText) {
        items.push(itemText)
      }
    }

    if (items.length > 0) {
      blocks.push({
        type: 'list',
        ordered,
        items,
      })
      continue
    }

    const fallbackItem = cleanInlineContent(innerHtml)
    if (fallbackItem) {
      blocks.push({
        type: 'paragraph',
        text: fallbackItem,
      })
    }
  }

  if (blocks.length > 0) {
    return blocks
  }

  return fallbackToParagraphBlocks(sanitizedHtml)
}
