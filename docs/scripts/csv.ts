/**
 * A strict RFC 4180 CSV parser for the checks: quoted fields, doubled quotes, commas and line
 * breaks inside quotes. It throws on anything malformed instead of guessing, because the demo
 * workspace's CSV files must import cleanly.
 */
export function parseCsv(source: string): string[][] {
  const text = source.replace(/\r\n/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          const next = text[i + 1];
          if (next !== undefined && next !== ',' && next !== '\n') {
            throw new Error(`Line ${rows.length + 1}: text after a closing quote`);
          }
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (fieldStarted)
        throw new Error(`Line ${rows.length + 1}: a quote inside an unquoted field`);
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
