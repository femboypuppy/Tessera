import { isSafeHref, TEXT_COLORS, type HighlightColor } from '@tessera/core';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { Highlight as BaseHighlight } from '@tiptap/extension-highlight';
import { Italic } from '@tiptap/extension-italic';
import { Link as BaseLink } from '@tiptap/extension-link';
import { Strike } from '@tiptap/extension-strike';
import { Underline } from '@tiptap/extension-underline';

export { Bold, Code, Italic, Strike, Underline };

/** Returns a valid highlight color name, or null (the default yellow). */
export function parseHighlightColor(value: unknown): HighlightColor | null {
  return typeof value === 'string' && (TEXT_COLORS as readonly string[]).includes(value)
    ? (value as HighlightColor)
    : null;
}

/**
 * `link`: `href` (always `isSafeHref`) and `title`. Not inclusive, so typing after a link doesn't
 * extend it. Clicks are handled by the page editor (Mod+click opens), and URL pastes by the paste
 * handler, so TipTap's own click and paste behaviors are off.
 */
export const Link = BaseLink.extend({
  inclusive: false,

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => {
          const href = element.getAttribute('href');
          return isSafeHref(href) ? href : null;
        },
        renderHTML: (attributes) =>
          isSafeHref(attributes.href) ? { href: String(attributes.href) } : {},
      },
      title: {
        default: null,
        parseHTML: (element) => {
          const title = element.getAttribute('title');
          return title && title.length <= 2000 ? title : null;
        },
      },
    };
  },
}).configure({
  openOnClick: false,
  linkOnPaste: false,
  autolink: true,
  enableClickSelection: false,
  defaultProtocol: 'https',
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
  isAllowedUri: (url) => isSafeHref(url),
  shouldAutoLink: (url) => /^https?:\/\//i.test(url) || /^www\./i.test(url),
});

/** `highlight`: one mark with an optional color from `TEXT_COLORS` (null = yellow). */
export const Highlight = BaseHighlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => parseHighlightColor(element.getAttribute('data-color')),
        renderHTML: (attributes) => {
          const color = parseHighlightColor(attributes.color);
          return color ? { 'data-color': color } : {};
        },
      },
    };
  },
}).configure({ multicolor: true });
