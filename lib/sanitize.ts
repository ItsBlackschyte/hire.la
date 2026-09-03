import sanitizeHtml from 'sanitize-html';

/**
 * ATS job descriptions are third-party HTML — sanitize before rendering.
 * Server-side only (used from ISR pages).
 */
export function cleanJobHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'div', 'span', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u',
      'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    ],
    allowedAttributes: { a: ['href'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' }),
      h1: 'h2',
    },
  });
}

/** Plain-text excerpt for meta descriptions and JSON-LD. */
export function textExcerpt(html: string, max = 200): string {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
