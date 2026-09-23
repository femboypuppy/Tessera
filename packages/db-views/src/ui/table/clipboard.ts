/**
 * Cells on the clipboard as tab-separated values, the format spreadsheets exchange: cells with
 * tabs, line breaks or quotes are quoted, quotes doubled.
 */

function quote(cell: string): string {
  return /[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Encodes a block of cells as TSV. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(quote).join('\t')).join('\n');
}

/** Escapes text for HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Encodes a block of cells as an HTML table (rich paste into documents and spreadsheets). */
export function toHtmlTable(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table>${body}</table>`;
}

/**
 * Decodes TSV (from spreadsheets or {@link toTsv}) into rows of cells. Quoted cells may contain
 * tabs and line breaks. A trailing line break (spreadsheets add one) does not make an empty row.
 */
export function fromTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const source = text.replace(/\r\n?/g, '\n');
  while (i < source.length) {
    const char = source[i] ?? '';
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
    i += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
