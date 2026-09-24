/**
 * Spreadsheet navigation for the table grid, as pure functions. Positions are indexes: rows -1
 * (the header) to rowCount - 1, then `rowCount` for the summary footer; columns 0 to colCount - 1.
 */

export interface GridPos {
  row: number;
  col: number;
}

/** The active cell and the other corner of the selected range. */
export interface GridSelection {
  active: GridPos;
  anchor: GridPos;
}

export interface GridBounds {
  rowCount: number;
  colCount: number;
  /** Rows per PageUp/PageDown. */
  pageSize: number;
  /** Whether the header (-1) and footer (rowCount) rows can be focused. */
  header: boolean;
  footer: boolean;
}

export interface NavigationKey {
  key: string;
  shiftKey: boolean;
  /** Ctrl on Windows and Linux, ⌘ on Apple platforms. */
  modKey: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function limits(bounds: GridBounds): { top: number; bottom: number } {
  return {
    top: bounds.header ? -1 : 0,
    bottom: bounds.footer ? bounds.rowCount : Math.max(0, bounds.rowCount - 1),
  };
}

/**
 * The selection after a navigation key, or null when the key does not navigate. Shift extends the
 * range (within body rows); Mod jumps to the edge; Tab moves right and wraps to the next row.
 */
export function navigate(
  selection: GridSelection,
  input: NavigationKey,
  bounds: GridBounds,
): GridSelection | null {
  const { active } = selection;
  const { top, bottom } = limits(bounds);
  const lastCol = Math.max(0, bounds.colCount - 1);
  const lastRow = Math.max(0, bounds.rowCount - 1);
  let next: GridPos;
  switch (input.key) {
    case 'ArrowUp':
      next = { row: input.modKey ? (active.row > 0 ? 0 : top) : active.row - 1, col: active.col };
      break;
    case 'ArrowDown':
      next = {
        row: input.modKey ? (active.row < lastRow ? lastRow : bottom) : active.row + 1,
        col: active.col,
      };
      break;
    case 'ArrowLeft':
      next = { row: active.row, col: input.modKey ? 0 : active.col - 1 };
      break;
    case 'ArrowRight':
      next = { row: active.row, col: input.modKey ? lastCol : active.col + 1 };
      break;
    case 'Home':
      next = input.modKey ? { row: 0, col: 0 } : { row: active.row, col: 0 };
      break;
    case 'End':
      next = input.modKey ? { row: lastRow, col: lastCol } : { row: active.row, col: lastCol };
      break;
    case 'PageUp':
      next = { row: active.row - bounds.pageSize, col: active.col };
      break;
    case 'PageDown':
      next = { row: active.row + bounds.pageSize, col: active.col };
      break;
    case 'Tab': {
      const step = input.shiftKey ? -1 : 1;
      let col = active.col + step;
      let row = active.row;
      if (col > lastCol) {
        if (row >= lastRow) return null;
        col = 0;
        row += 1;
      } else if (col < 0) {
        if (row <= 0) return null;
        col = lastCol;
        row -= 1;
      }
      const pos = { row, col };
      return { active: pos, anchor: pos };
    }
    default:
      return null;
  }
  const pos = {
    row: clamp(next.row, top, bottom),
    col: clamp(next.col, 0, lastCol),
  };
  if (bounds.rowCount === 0) pos.row = clamp(pos.row, top, bottom);
  // Ranges only cover body rows; moving into the header or footer collapses them.
  const extend =
    input.shiftKey && pos.row >= 0 && pos.row < bounds.rowCount && selection.anchor.row >= 0;
  return { active: pos, anchor: extend ? selection.anchor : pos };
}

/** The rectangle between the active cell and the anchor. */
export interface GridRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function selectionRange(selection: GridSelection): GridRange {
  return {
    top: Math.min(selection.active.row, selection.anchor.row),
    bottom: Math.max(selection.active.row, selection.anchor.row),
    left: Math.min(selection.active.col, selection.anchor.col),
    right: Math.max(selection.active.col, selection.anchor.col),
  };
}

export function rangeSize(range: GridRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

export function inRange(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}
