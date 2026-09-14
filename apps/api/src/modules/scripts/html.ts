/** The exact encoding `0030_taxonomy.js` used to fold `scripts.text` into `documents.body_html`. */
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
