// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractPlainText } from '../schema/extract';
import { validateDocJSON } from '../schema/docjson';
import { BasicMarkdownCodec } from './markdown-codec';

describe('BasicMarkdownCodec.parseHTML (DOM)', () => {
  it('keeps headings and text, never raw HTML', () => {
    const codec = new BasicMarkdownCodec();
    const doc = codec.parseHTML(
      '<h2>Agenda</h2><p>Discuss <img src=x onerror=alert(1)><a href="javascript:alert(1)">this</a></p><ul><li>One</li><li>Two</li></ul><style>p{}</style><script>alert(1)</script><table><tr><td>Cell</td></tr></table>',
    );
    expect(validateDocJSON(doc).ok).toBe(true);
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(extractPlainText(doc)).toBe('Agenda\nDiscuss this\nOne\nTwo\nCell');
    expect(JSON.stringify(doc)).not.toContain('javascript');
    expect(extractPlainText(codec.parseHTML('just text'))).toBe('just text');
  });
});
