import { build as b } from './builders';
import type { DocJSON } from './types';

/** IDs used by the fixture documents. */
export const FIXTURE_IDS = {
  spec: 'spec-page-000000000001',
  roadmap: 'roadmap-page-00000002',
  apollo: 'apollo-page-000000003',
  database: 'database-page-0000004',
  view: 'view-id-0000000000005',
  asset: 'a'.repeat(64),
  fileAsset: 'b'.repeat(64),
} as const;

const { spec, roadmap, apollo, database, view, asset, fileAsset } = FIXTURE_IDS;

/**
 * A document that uses every node type, every mark and links inside every container: nested
 * lists, tasks, tables, toggles, quotes and callouts, plus unicode text. Tests across packages use
 * it to check that nothing is lost.
 */
export function kitchenSinkDoc(): DocJSON {
  return b.doc(
    b.heading(1, 'Apollo 11 🚀 — mission notes'),
    b.paragraph(
      'Read the ',
      b.pageLink(spec),
      ' first, then ',
      b.text('bold', b.mark.bold()),
      ', ',
      b.text('italic', b.mark.italic()),
      ', ',
      b.text('underline', b.mark.underline()),
      ', ',
      b.text('strike', b.mark.strike()),
      ', ',
      b.text('code()', b.mark.code()),
      ', ',
      b.text('a link', b.mark.link('https://www.nasa.gov', 'NASA')),
      ' and ',
      b.text('highlighted', b.mark.highlight('green'), b.mark.bold()),
      '.',
      b.hardBreak(),
      'Tags: ',
      b.tag('space/history'),
      ' ',
      b.tag('apollo'),
    ),
    b.heading(2, 'Crew'),
    b.bulletList(
      b.listItem(
        b.paragraph(
          'Neil Armstrong, see ',
          b.pageLink(apollo, { label: 'the landing', heading: 'Descent' }),
        ),
        b.orderedList(
          b.listItem(b.paragraph('Commander ', b.pageLink(roadmap, { blockRef: 'step-1' }))),
        ),
      ),
      'Buzz Aldrin',
    ),
    b.orderedList('Launch', 'Landing'),
    b.taskList(
      b.taskItem(
        true,
        b.paragraph('Pack the ', b.pageLink(spec)),
        b.taskList(b.taskItem(false, 'Subtask')),
      ),
      b.taskItem(false, 'Return safely'),
    ),
    b.blockquote(b.paragraph('That’s one small step for man ', b.pageLink(apollo))),
    b.callout({ emoji: '⚠️', tone: 'warning' }, b.paragraph('Fuel low: ', b.pageLink(roadmap))),
    b.codeBlock('const orbit = () => {\n  return "moon";\n};', 'typescript'),
    b.horizontalRule(),
    b.image({ assetId: asset, alt: 'Earthrise', title: 'Earthrise, 1968', width: 80 }),
    b.image({ src: 'https://images.example.com/moon.png', alt: 'Moon' }),
    b.table(
      { header: true },
      ['Name', 'Role'],
      [b.tableCell(b.paragraph('Michael ', b.pageLink(spec))), 'Pilot'],
    ),
    b.toggle(
      ['Details with ', b.pageLink(roadmap)],
      [b.paragraph('Hidden ', b.pageLink(apollo)), b.bulletList('Inside')],
      {
        open: true,
      },
    ),
    b.embed('database', database, { viewId: view }),
    b.embed('web', 'https://www.youtube.com/watch?v=abc', { display: 'embed' }),
    b.embed('file', fileAsset, {
      name: 'flight-plan.pdf',
      size: 1024,
      mimeType: 'application/pdf',
    }),
    b.embed('plugin:mermaid/diagram', null, { source: 'graph TD; A-->B' }),
    b.paragraph('Unicode: 日本語テキスト, العربية, Ελληνικά, é, 👩‍🚀'),
    b.paragraph(),
  );
}
