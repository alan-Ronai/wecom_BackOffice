/**
 * The exact encoding `0030_taxonomy.js` used to fold `scripts.text` into `documents.body_html`.
 *
 * All that is left of the `scripts` module: the `/scripts*` adapter routes over `doc_type='T'`
 * were removed once the web's three readers moved to `GET /documents?docType=T`. This pair stays
 * because the encoding itself is still load-bearing — the seed writes type-T bodies with it and
 * `search` reads them back out — and it has to keep matching the migration exactly.
 */
export const textToHtml = (text: string): string =>
  '<p>' +
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') +
  '</p>';

export const htmlToText = (html: string): string =>
  html
    .replace(/^<p>|<\/p>$/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
