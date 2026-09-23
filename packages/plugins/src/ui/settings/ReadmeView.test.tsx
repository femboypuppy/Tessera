// @vitest-environment jsdom
import type { DocJSON } from '@tessera/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadmeView } from './ReadmeView';

afterEach(cleanup);

const text = (value: string, marks?: Array<{ type: string; attrs?: object }>) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

function doc(...content: unknown[]): DocJSON {
  return { type: 'doc', content } as DocJSON;
}

describe('ReadmeView', () => {
  it('renders headings, lists, code and marks, leaving out a title that repeats the name', () => {
    const { container } = render(
      <ReadmeView
        pluginName="Word count"
        doc={doc(
          { type: 'heading', attrs: { level: 1 }, content: [text('Word count 🔢')] },
          {
            type: 'paragraph',
            content: [text('Counts '), text('words', [{ type: 'bold' }]), text(' as you type.')],
          },
          { type: 'heading', attrs: { level: 2 }, content: [text('Settings')] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [text('Goal', [{ type: 'code' }])] }],
              },
            ],
          },
          { type: 'codeBlock', content: [text('pnpm test')] },
        )}
      />,
    );
    expect(screen.queryByText('Word count 🔢')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('words');
    expect(screen.getByRole('heading', { name: 'Settings', level: 6 })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('Goal');
    expect(container.querySelector('li code')?.textContent).toBe('Goal');
    expect(container.querySelector('pre code')?.textContent).toBe('pnpm test');
  });

  it('keeps a title that says more than the name', () => {
    render(
      <ReadmeView
        pluginName="Pomodoro"
        doc={doc({ type: 'heading', attrs: { level: 1 }, content: [text('Pomodoro for teams')] })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Pomodoro for teams', level: 5 })).toBeTruthy();
  });

  it('opens only web and mail links, in a new tab, and never renders markup', () => {
    const link = (href: string) => [{ type: 'link', attrs: { href } }];
    const { container } = render(
      <ReadmeView
        pluginName="P"
        doc={doc({
          type: 'paragraph',
          content: [
            text('Docs', link('https://example.com/docs')),
            text(' Mail', link('mailto:me@example.com')),
            text(' Script', link('javascript:alert(1)')),
            text(' <img src=x onerror=alert(1)>'),
          ],
        })}
      />,
    );
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual([
      'https://example.com/docs',
      'mailto:me@example.com',
    ]);
    expect(anchors.every((anchor) => anchor.getAttribute('rel') === 'noopener noreferrer')).toBe(
      true,
    );
    expect(anchors.every((anchor) => anchor.getAttribute('target') === '_blank')).toBe(true);
    expect(screen.getByText('Script', { exact: false }).closest('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders nothing for an empty README', () => {
    const { container } = render(
      <ReadmeView
        pluginName="Random page"
        doc={doc({ type: 'heading', attrs: { level: 1 }, content: [text('Random page')] })}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
