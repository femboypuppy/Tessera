import { describe, expect, it } from 'vitest';
import { displayHost, normalizeUrlInput, resolveEmbed } from './providers';

describe('resolveEmbed', () => {
  it.each([
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'youtube',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'youtube',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42',
    ],
    [
      'https://www.youtube.com/shorts/abcDEF12345',
      'youtube',
      'https://www.youtube-nocookie.com/embed/abcDEF12345',
    ],
    ['https://vimeo.com/76979871', 'vimeo', 'https://player.vimeo.com/video/76979871'],
    [
      'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
      'loom',
      'https://www.loom.com/embed/0123456789abcdef0123456789abcdef',
    ],
    [
      'https://codepen.io/tessera/pen/abcXYZ',
      'codepen',
      'https://codepen.io/tessera/embed/abcXYZ?default-tab=result',
    ],
  ])('embeds %s with %s', (url, provider, src) => {
    const result = resolveEmbed(url);
    expect(result?.provider.id).toBe(provider);
    expect(result?.src).toBe(src);
  });

  it('embeds Figma files through the Figma embed URL', () => {
    const result = resolveEmbed('https://www.figma.com/design/AbCdEfGhIjKlMn/Launch?node-id=1-2');
    expect(result?.provider.id).toBe('figma');
    expect(result?.src.startsWith('https://www.figma.com/embed?embed_host=tessera&url=')).toBe(
      true,
    );
  });

  it.each([
    'https://example.com/video',
    'https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=<script>',
    'javascript:alert(1)',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
  ])('refuses %s (not on the allowlist)', (url) => {
    expect(resolveEmbed(url)).toBeNull();
  });
});

describe('URL helpers', () => {
  it('normalizes typed links', () => {
    expect(normalizeUrlInput('tessera.dev/docs')).toBe('https://tessera.dev/docs');
    expect(normalizeUrlInput(' https://a.b/c ')).toBe('https://a.b/c');
    expect(normalizeUrlInput('not a url')).toBeNull();
    expect(normalizeUrlInput('javascript:alert(1)')).toBeNull();
    expect(normalizeUrlInput('http://localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeUrlInput('intranet')).toBeNull();
  });

  it('shows hosts without www', () => {
    expect(displayHost('https://www.nasa.gov/moon')).toBe('nasa.gov');
  });
});
