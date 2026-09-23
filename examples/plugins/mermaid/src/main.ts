import { defineBlock, definePlugin } from '@tessera/plugin-api';
import { renderBlock, type DiagramData } from './block';
import { DEFAULT_CODE } from './templates';

export default definePlugin({
  activate(api) {
    api.ui.addBlock({
      type: 'diagram',
      title: 'Mermaid diagram',
      description: 'Flowcharts, sequences, timelines and more, written as text.',
      icon: '🧜',
      keywords: ['mermaid', 'diagram', 'flowchart', 'chart', 'graph', 'sequence', 'gantt'],
      initialData: { code: DEFAULT_CODE },
    });
  },
  blocks: {
    diagram: defineBlock<DiagramData>(renderBlock),
  },
});
