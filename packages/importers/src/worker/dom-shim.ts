import { characterEntities } from 'character-entities';

/**
 * micromark decodes named character references (`&nbsp;`) through
 * `decode-named-character-reference`, whose browser build parses them with a DOM element
 * created when the module loads. Workers have no DOM, so this module (imported first by the
 * worker) provides the one thing it uses, backed by the same entity table as its Node build.
 */
function createDecoderElement() {
  let text = '';
  return {
    set innerHTML(value: string) {
      const name = /^&([A-Za-z][A-Za-z0-9]*);$/.exec(value)?.[1];
      text =
        name && Object.hasOwn(characterEntities, name) ? (characterEntities[name] ?? value) : value;
    },
    get textContent() {
      return text;
    },
  };
}

const scope = globalThis as { document?: unknown };
if (typeof scope.document === 'undefined') {
  scope.document = { createElement: createDecoderElement };
}

export {};
