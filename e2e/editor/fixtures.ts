import { deflateSync } from 'node:zlib';

/** CRC-32 of a buffer (for PNG chunks). */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes an RGB image as a PNG. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A night sky over the Moon's horizon with the Earth rising (an "Earthrise" stand-in). */
export function earthrise(width = 960, height = 420): Buffer {
  const stars = new Set<number>();
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 260; i += 1)
    stars.add(Math.floor(random() * width) + Math.floor(random() * height * 0.7) * width);
  const earthX = width * 0.68;
  const earthY = height * 0.42;
  const earthR = height * 0.16;
  return encodePng(width, height, (x, y) => {
    const horizon = height * 0.74 + Math.sin(x / 70) * 10 + Math.sin(x / 23) * 4;
    if (y > horizon) {
      const shade = 110 + Math.round(40 * Math.sin(x / 9 + y / 13) * Math.cos(y / 7));
      const fade = Math.min(1, (y - horizon) / 60);
      const value = Math.round(shade * (0.55 + 0.45 * fade));
      return [value, value, value - 6];
    }
    const dx = x - earthX;
    const dy = y - earthY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < earthR) {
      const lit = Math.max(0, (-dx * 0.6 - dy * 0.8) / earthR + 0.35);
      const cloud = Math.sin(x / 6 + y / 11) * Math.cos(y / 5) > 0.55;
      const land = Math.sin(x / 15) * Math.cos(y / 12) > 0.3;
      const base: [number, number, number] = cloud
        ? [235, 240, 245]
        : land
          ? [70, 120, 70]
          : [40, 90, 170];
      return base.map((channel) => Math.round(channel * Math.min(1, lit))) as [
        number,
        number,
        number,
      ];
    }
    if (stars.has(x + y * width)) return [230, 232, 240];
    const glow = Math.max(0, 1 - distance / (earthR * 1.6)) * 28;
    const sky = Math.round(8 + (y / height) * 16 + glow);
    return [sky, sky, sky + 10];
  });
}

/** A small, recognizable image for upload tests. */
export const PNG_ROCKET = encodePng(96, 96, (x, y) => {
  const inBody = Math.abs(x - 48) < 12 && y > 18 && y < 74;
  const inNose = y <= 18 && y > 4 && Math.abs(x - 48) < (y - 4) * 0.85;
  const inFlame = y >= 74 && y < 90 && Math.abs(x - 48) < (90 - y) * 0.6;
  if (inNose) return [220, 60, 70];
  if (inBody) return [235, 235, 240];
  if (inFlame) return [250, 170, 40];
  return [30, 34, 60];
});

/** Markdown pasted from a notes app or a README. */
export const MARKDOWN_FIXTURE = [
  '# Launch checklist',
  '',
  'The **crew** boards at *dawn*.',
  '',
  '## Before liftoff',
  '',
  '- Fuel the rocket',
  '- Check the weather',
  '',
  '1. Board',
  '2. Launch',
  '',
  '- [x] Suits pressurized',
  '- [ ] Hatch closed',
  '',
  '> We choose to go to the Moon.',
  '',
  '```js',
  'countdown(10);',
  '```',
].join('\n');

/** HTML the way Google Docs puts it on the clipboard (inline styles, a wrapper `<b>`). */
export const GOOGLE_DOCS_HTML =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><h2 dir="ltr" style="line-height:1.38"><span style="font-size:16pt">Flight notes</span></h2>' +
  '<p dir="ltr" style="line-height:1.38"><span style="font-weight:700">Orbit</span><span> reached at T+12 minutes.</span></p>' +
  '<ul><li dir="ltr"><p dir="ltr"><span>Stage one</span></p></li><li dir="ltr"><p dir="ltr"><span>Stage two</span></p></li></ul></b>';

/** HTML from a web page, with things that must never survive (scripts, handlers, iframes). */
export const WEB_PAGE_HTML =
  '<article><h1>Apollo 11</h1><p>Apollo 11 was the <a href="https://www.nasa.gov/apollo">first crewed landing</a> on the Moon.' +
  '<script>window.__pwned = true</script><img src="x" onerror="window.__pwned = true"></p>' +
  '<iframe src="https://evil.example"></iframe><p>Launch: <em>July 16, 1969</em>.</p></article>';

/** HTML the way Notion copies blocks. */
export const NOTION_HTML =
  '<h3>Mission roles</h3><p>Commander: <strong>Neil Armstrong</strong></p>' +
  '<ul><li>Lunar module pilot: Buzz Aldrin</li><li>Command module pilot: Michael Collins</li></ul>' +
  '<blockquote>Houston, Tranquility Base here.</blockquote>';

/** The plain-text flavors apps put on the clipboard next to the HTML. */
export const GOOGLE_DOCS_TEXT =
  'Flight notes\nOrbit reached at T+12 minutes.\nStage one\nStage two';
export const NOTION_TEXT =
  '### Mission roles\n\nCommander: **Neil Armstrong**\n\n- Lunar module pilot: Buzz Aldrin\n- Command module pilot: Michael Collins\n\n> Houston, Tranquility Base here.';
export const WEB_PAGE_TEXT =
  'Apollo 11\nApollo 11 was the first crewed landing on the Moon.\nLaunch: July 16, 1969.';
