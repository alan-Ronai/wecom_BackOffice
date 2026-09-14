import { createHash } from 'node:crypto';
import { paragraphsText, type Paragraph } from '@wecom/shared';

// Moved to @wecom/shared (wave 4, W4): the normalizer is shared by the source editor, the
// sanitizer tests and the WordPress connector. Re-exported so existing imports keep working.
export { normalizeText, htmlToParagraphs, paragraphsText } from '@wecom/shared';

export const contentHash = (ps: Paragraph[]): string =>
  createHash('sha256').update(paragraphsText(ps), 'utf8').digest('hex');
