import { describe, it, expect } from 'vitest';
import { sanitizeHtml, ASSET_SRC_RE } from '../src/index.js';

const A = '/api/v1/assets/11111111-1111-4111-8111-111111111111';

describe('sanitizeHtml', () => {
  it('keeps the allowlisted structure', () => {
    const html = `<h2>כותרת</h2><p dir="rtl">טקסט <strong>מודגש</strong> <em>נטוי</em> <u>קו</u> <s>מחוק</s></p><ul><li>א</li></ul><ol><li>1</li></ol><table><thead><tr><th colspan="2">x</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><blockquote>ציטוט</blockquote><pre><code>x</code></pre><hr><br>`;
    const out = sanitizeHtml(html);
    for (const tag of [
      '<h2>',
      '<strong>',
      '<em>',
      '<u>',
      '<s>',
      '<ul>',
      '<ol>',
      '<table>',
      '<thead>',
      '<tbody>',
      '<th colspan="2">',
      '<blockquote>',
      '<pre>',
      '<code>',
      '<hr>',
      '<br>',
    ])
      expect(out).toContain(tag);
  });
  it('strips scripts, handlers, styles and unknown tags but keeps their text', () => {
    const out = sanitizeHtml(
      `<p onclick="x()" style="color:red">שלום<script>alert(1)</script><iframe src="x"></iframe><div>בתוך</div></p>`,
    );
    // HTML5 (and node-html-parser) close an open <p> when a <div> opens, so the unwrapped div text
    // lands after the paragraph. Still well-formed and idempotent — asserted below.
    expect(out).toBe('<p>שלום</p>בתוך');
    expect(sanitizeHtml(out)).toBe(out);
  });
  it('allows only asset images and rejects data URIs and remote images', () => {
    expect(sanitizeHtml(`<img src="${A}" alt="x">`)).toBe(`<img src="${A}" alt="x">`);
    expect(sanitizeHtml(`<img src="data:image/png;base64,AAAA">`)).toBe('');
    expect(sanitizeHtml(`<img src="https://evil/x.png">`)).toBe('');
    expect(ASSET_SRC_RE.test(A)).toBe(true);
    // C-M1: a real UUID, not any 36 characters of hex and hyphens. A malformed src used to
    // survive into stored HTML and then silently vanish in htmlToDocx and the WordPress push.
    expect(ASSET_SRC_RE.test('/api/v1/assets/' + '-'.repeat(36))).toBe(false);
    expect(sanitizeHtml(`<img src="/api/v1/assets/${'-'.repeat(36)}">`)).toBe('');
  });

  // C-M2: the decoder used to chain `.replace()` calls, so the `&amp;` pass fed the `&lt;`
  // pass. A user who literally typed `&lt;script&gt;` got `<script>` back as rendered text —
  // a one-shot content mutation on save in the system of record.
  it('decodes entities in one pass, so double-encoded text survives', () => {
    expect(sanitizeHtml('<p>&amp;lt;script&amp;gt;</p>')).toBe('<p>&amp;lt;script&amp;gt;</p>');
    expect(sanitizeHtml('<p>a &amp; b</p>')).toBe('<p>a &amp; b</p>');
    const once = sanitizeHtml('<p>&amp;lt;b&amp;gt; &amp; &quot;q&quot;</p>');
    expect(sanitizeHtml(once)).toBe(once); // still idempotent
  });
  // C-M6: `target` is stripped, so `noopener` alone is inert; `noreferrer` is the half that
  // stops a `Referer` leak to a third-party link from an internal KB.
  it('allows http(s) links only and adds rel="noopener noreferrer"', () => {
    expect(sanitizeHtml('<a href="https://wecom.co.il/x">קישור</a>')).toBe(
      '<a href="https://wecom.co.il/x" rel="noopener noreferrer">קישור</a>',
    );
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a rel="noopener noreferrer">x</a>',
    );
  });
  it('keeps dir on span and bdi, drops everything else', () => {
    expect(sanitizeHtml('<span dir="ltr" class="c" id="i">abc</span><bdi dir="ltr">x</bdi>')).toBe(
      '<span dir="ltr">abc</span><bdi dir="ltr">x</bdi>',
    );
  });
  it('escapes text nodes', () => {
    expect(sanitizeHtml('<p>a &lt; b &amp;&amp; c</p>')).toBe('<p>a &lt; b &amp;&amp; c</p>');
  });
  it('is idempotent', () => {
    const once = sanitizeHtml('<h1>x</h1><p><a href="http://a">b</a></p>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});
