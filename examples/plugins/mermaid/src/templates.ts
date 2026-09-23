/** Starting points for new diagrams. */
export interface DiagramTemplate {
  id: string;
  label: string;
  code: string;
}

export const TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    code: `flowchart LR
  capture([Capture an idea]) --> keep{Worth keeping?}
  keep -- Yes --> link[Link it to a project]
  keep -- Not now --> inbox[(Inbox)]
  link --> ship([Ship it 🚀])`,
  },
  {
    id: 'sequence',
    label: 'Sequence',
    code: `sequenceDiagram
  participant You
  participant Tessera
  participant Server
  You->>Tessera: Edit a page
  Tessera->>Tessera: Save on this device
  Tessera-)Server: Sync the change
  Server--)Tessera: Changes from teammates`,
  },
  {
    id: 'gantt',
    label: 'Timeline',
    code: `gantt
  title Launch plan
  dateFormat YYYY-MM-DD
  section Build
    Editor        :done,    a1, 2026-09-01, 14d
    Plugins       :active,  a2, 2026-09-08, 16d
  section Launch
    Docs          :         a3, after a2, 5d
    Release       :milestone, after a3, 0d`,
  },
  {
    id: 'class',
    label: 'Class diagram',
    code: `classDiagram
  class Page {
    +String title
    +String icon
    +trash()
  }
  class Database {
    +Property[] properties
    +addRow()
  }
  Database --|> Page
  Page "1" --> "*" Page : children`,
  },
  {
    id: 'state',
    label: 'State diagram',
    code: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : ready
  Review --> Draft : changes requested
  Review --> Published : approved
  Published --> [*]`,
  },
  {
    id: 'pie',
    label: 'Pie chart',
    code: `pie title Where the week went
  "Deep work" : 18
  "Meetings" : 9
  "Email" : 6
  "Learning" : 4`,
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    code: `mindmap
  root((Tessera))
    Write
      Blocks
      Links
    Organize
      Databases
      Tags
    Share
      Sync
      Export`,
  },
];

/** The diagram a new block starts with. */
export const DEFAULT_CODE = TEMPLATES[0]?.code ?? 'flowchart LR\n  A --> B';
