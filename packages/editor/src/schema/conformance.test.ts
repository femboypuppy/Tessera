import {
  describeSchema,
  diffSchemaDescriptions,
  docJSONEqual,
  normalizeDocJSON,
  SCHEMA_DESCRIPTION,
  validateDocJSON,
} from '@tessera/core';
import { kitchenSinkDoc } from '@tessera/core/testing';
import { Editor, getSchema } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { schemaExtensions } from './index';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('schema conformance', () => {
  it('generates exactly the canonical schema (SCHEMA_DESCRIPTION)', () => {
    const schema = getSchema(schemaExtensions());
    expect(diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(schema))).toEqual([]);
  });

  it('keeps conforming with resizable tables (the page editor configuration)', () => {
    const schema = getSchema(schemaExtensions({ resizableTables: true }));
    expect(diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(schema))).toEqual([]);
  });

  it('matches the schema of a live editor', () => {
    editor = new Editor({ extensions: schemaExtensions() });
    expect(diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(editor.schema))).toEqual([]);
  });

  it('loads and returns the kitchen sink document without losing anything', () => {
    const doc = kitchenSinkDoc();
    editor = new Editor({ extensions: schemaExtensions(), content: doc });
    const json = editor.getJSON();
    expect(validateDocJSON(normalizeDocJSON(json)).ok).toBe(true);
    expect(docJSONEqual(json, doc)).toBe(true);
  });

  it('round-trips the kitchen sink through its own HTML', () => {
    const doc = kitchenSinkDoc();
    editor = new Editor({ extensions: schemaExtensions(), content: doc });
    const html = editor.getHTML();
    const copy = new Editor({ extensions: schemaExtensions(), content: html });
    try {
      // Everything survives HTML except what HTML can't carry by design: nothing.
      expect(docJSONEqual(copy.getJSON(), doc)).toBe(true);
    } finally {
      copy.destroy();
    }
  });
});
