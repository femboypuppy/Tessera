import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  MoreHorizontal,
  PanelTop,
  Plus,
  Rows3,
  Trash2,
} from 'lucide-react';
import { useLayoutEffect, useState, type RefObject } from 'react';
import { t } from '../i18n';
import type { EditorController } from './controller';
import { useStore } from './store';

/** Position of the table around the selection, or null. */
function tableAround(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return $from.before(depth);
  }
  return null;
}

/** Puts the caret in a cell (the last row's first cell, or the first row's last cell). */
function focusEdgeCell(editor: Editor, tablePos: number, edge: 'lastRow' | 'lastColumn'): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table) return false;
  let pos = tablePos + 1;
  if (edge === 'lastRow') {
    for (let i = 0; i < table.childCount - 1; i += 1) pos += table.child(i).nodeSize;
    pos += 1; // into the row, at its first cell
  } else {
    const row = table.firstChild;
    if (!row) return false;
    pos += 1;
    for (let i = 0; i < row.childCount - 1; i += 1) pos += row.child(i).nodeSize;
  }
  const selection = TextSelection.near(editor.state.doc.resolve(pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return true;
}

/**
 * Controls for the table with the caret: a menu (insert and delete rows and columns, header row,
 * delete table) at its top-right corner, and "+" bars along the bottom and right edges.
 */
export function TableControls({
  controller,
  editor,
  root,
}: {
  controller: EditorController;
  editor: Editor;
  root: RefObject<HTMLElement | null>;
}) {
  const readOnly = useStore(controller.readOnly);
  // The table with the caret (its node changes when it's edited). Outside tables this stays null,
  // so typing elsewhere never re-renders (a React commit walks the whole editor DOM to save the
  // selection, which is slow on long pages).
  const around = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const pos = tableAround(current);
      return pos === null ? null : { pos, node: current.state.doc.nodeAt(pos) };
    },
    equalityFn: (a, b) => a?.pos === b?.pos && a?.node === b?.node,
  });
  const tablePos = around?.pos ?? null;
  const tableNode = around?.node ?? null;
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (tablePos === null || readOnly) {
      setBox(null);
      return;
    }
    const dom = editor.view.nodeDOM(tablePos);
    const container = root.current?.getBoundingClientRect();
    const table = dom instanceof HTMLElement ? (dom.querySelector('table') ?? dom) : null;
    if (!table || !container) {
      setBox(null);
      return;
    }
    const rect = table.getBoundingClientRect();
    setBox({
      top: rect.top - container.top,
      left: rect.left - container.left,
      width: rect.width,
      height: rect.height,
    });
  }, [editor, tablePos, tableNode, readOnly, root]);

  if (tablePos === null || !box || readOnly) return null;
  const run =
    (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () =>
      command(editor.chain().focus()).run();
  const table = editor.state.doc.nodeAt(tablePos);
  const headerRow = table?.firstChild?.firstChild?.type.name === 'tableHeader';
  const edgeButton =
    'absolute flex items-center justify-center rounded-md border border-border bg-surface text-fg-subtle opacity-70 transition-opacity duration-fast hover:bg-hover hover:text-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <>
      <div className="absolute z-10" style={{ top: box.top - 32, left: box.left + box.width - 28 }}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md border border-border bg-surface text-fg-muted shadow-subtle hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
              aria-label={t('tableOptions')}
              title={t('tableOptions')}
              onMouseDown={(event) => event.preventDefault()}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuItem
              icon={<ArrowUpToLine />}
              onSelect={run((chain) => chain.addRowBefore())}
            >
              {t('addRowAbove')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowDownToLine />}
              onSelect={run((chain) => chain.addRowAfter())}
            >
              {t('addRowBelow')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowLeftToLine />}
              onSelect={run((chain) => chain.addColumnBefore())}
            >
              {t('addColumnLeft')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowRightToLine />}
              onSelect={run((chain) => chain.addColumnAfter())}
            >
              {t('addColumnRight')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<PanelTop />}
              onSelect={run((chain) => chain.toggleHeaderRow())}
            >
              <span className="flex items-center justify-between gap-2">
                {t('headerRow')}
                <span className="text-2xs text-fg-subtle">{headerRow ? '✓' : ''}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Rows3 />} onSelect={run((chain) => chain.deleteRow())}>
              {t('deleteRow')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Columns3 />} onSelect={run((chain) => chain.deleteColumn())}>
              {t('deleteColumn')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Trash2 />}
              destructive
              onSelect={run((chain) => chain.deleteTable())}
            >
              {t('deleteTable')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button
        type="button"
        className={edgeButton}
        style={{ top: box.top + box.height + 4, left: box.left, width: box.width, height: 18 }}
        aria-label={t('addRow')}
        title={t('addRow')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (focusEdgeCell(editor, tablePos, 'lastRow'))
            editor.chain().focus().addRowAfter().run();
        }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={edgeButton}
        style={{ top: box.top, left: box.left + box.width + 4, width: 18, height: box.height }}
        aria-label={t('addColumn')}
        title={t('addColumn')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (focusEdgeCell(editor, tablePos, 'lastColumn'))
            editor.chain().focus().addColumnAfter().run();
        }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </>
  );
}
