import type { NodeViewRenderer } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorController } from '../react/controller';
import { calloutView } from './callout';
import { codeBlockView } from './code-block';
import { EmbedView } from './EmbedView';
import { ImageView } from './ImageView';
import { pageLinkView, tagView } from './inline';
import { toggleView } from './toggle';

/**
 * The page editor's node views. Simple nodes use plain DOM (fast on long pages); images and embeds
 * use React because they render async content and other features' components.
 */
export function createNodeViews(controller: EditorController): Record<string, NodeViewRenderer> {
  return {
    callout: calloutView(controller),
    toggle: toggleView(),
    codeBlock: codeBlockView(controller),
    pageLink: pageLinkView(controller),
    tag: tagView(controller),
    image: ReactNodeViewRenderer(ImageView, { className: 'tess-node-image' }),
    embed: ReactNodeViewRenderer(EmbedView, { className: 'tess-node-embed' }),
  };
}
