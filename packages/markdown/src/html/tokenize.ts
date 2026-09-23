import { characterEntities } from 'character-entities';

/**
 * A small, forgiving HTML tokenizer for HTML found inside markdown (and for `parseHTML` where no
 * DOM exists, such as in a worker). It never produces HTML: callers map a whitelist of tags to
 * document structure and keep only the text of everything else, so its output is inherently
 * sanitized. Script, style and template contents are dropped.
 */
export type HtmlToken =
  | { type: 'text'; value: string }
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'comment'; value: string };

const DROPPED_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object']);

/** Decodes character references (`&amp;`, `&#x1F600;`, `&nbsp;`). */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g,
    (match, ref: string) => {
      if (ref.startsWith('#')) {
        const hex = ref[1] === 'x' || ref[1] === 'X';
        const code = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (
          !Number.isFinite(code) ||
          code <= 0 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
        )
          return '�';
        return String.fromCodePoint(code);
      }
      return Object.hasOwn(characterEntities, ref) ? (characterEntities[ref] ?? match) : match;
    },
  );
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (!name || Object.hasOwn(attrs, name)) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * Splits HTML into tokens.
 *
 * @example
 * tokenizeHtml('<b>Hi</b> &amp; bye'); // open b, text "Hi", close b, text " & bye"
 */
export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let index = 0;
  let text = '';
  const flushText = () => {
    if (text) tokens.push({ type: 'text', value: decodeEntities(text) });
    text = '';
  };
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt < 0) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, lt);
    index = lt;
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      flushText();
      tokens.push({ type: 'comment', value: html.slice(index + 4, end < 0 ? html.length : end) });
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', index) || html.startsWith('<?', index)) {
      // Doctype, CDATA, processing instruction: skip.
      const end = html.indexOf('>', index);
      index = end < 0 ? html.length : end + 1;
      continue;
    }
    const tag = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^>]*?)?)\s*(\/?)>/.exec(
      html.slice(index, index + 4096),
    );
    if (!tag?.[2]) {
      text += '<';
      index += 1;
      continue;
    }
    flushText();
    const name = tag[2].toLowerCase();
    index += tag[0].length;
    if (tag[1]) {
      tokens.push({ type: 'close', name });
      continue;
    }
    tokens.push({
      type: 'open',
      name,
      attrs: parseAttributes(tag[3] ?? ''),
      selfClosing: tag[4] === '/',
    });
    if (DROPPED_CONTENT.has(name) && tag[4] !== '/') {
      tokens.pop();
      const close = html.toLowerCase().indexOf(`</${name}`, index);
      if (close < 0) {
        index = html.length;
      } else {
        const end = html.indexOf('>', close);
        index = end < 0 ? html.length : end + 1;
      }
    }
  }
  flushText();
  return tokens;
}
