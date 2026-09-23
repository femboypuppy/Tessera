import {
  asciiAlphanumeric,
  asciiDigit,
  markdownLineEnding,
  markdownLineEndingOrSpace,
  markdownSpace,
  unicodePunctuation,
  unicodeWhitespace,
} from 'micromark-util-character';
import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';
import type {
  Code,
  Construct,
  Effects,
  Event,
  Extension,
  Resolver,
  State,
  Token,
  TokenizeContext,
} from 'micromark-util-types';
import './nodes';

/**
 * micromark syntax extensions for Obsidian-flavored markdown:
 *
 * - `[[target#heading^block|alias]]` wikilinks and `![[target]]` embeds;
 * - `#tags` (after whitespace or at the start of a line, Obsidian's rule);
 * - `==highlights==` (the same flanking rules as GFM strikethrough);
 * - `^block-id` markers at the end of a line.
 *
 * They are real tokenizers (not regexes over text), so escapes (`\[\[`, `\#`, `\=\=`) and code
 * spans keep their meaning, and serializing then parsing is stable.
 */

const EXCLAMATION = 33;
const NUMBER_SIGN = 35;
const DASH = 45;
const SLASH = 47;
const EQUALS = 61;
const LEFT_BRACKET = 91;
const BACKSLASH = 92;
const RIGHT_BRACKET = 93;
const CARET = 94;
const UNDERSCORE = 95;

const MAX_WIKILINK_LENGTH = 2000;
const MAX_TAG_LENGTH = 100;
const MAX_BLOCK_ID_LENGTH = 64;

// ---------------------------------------------------------------------------------------------
// Wikilinks and embeds
// ---------------------------------------------------------------------------------------------

function tokenizeWikiLink(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    effects.enter('wikiLink');
    if (code === EXCLAMATION) {
      effects.enter('wikiLinkEmbedMarker');
      effects.consume(code);
      effects.exit('wikiLinkEmbedMarker');
      return openFirst;
    }
    return openFirst(code);
  }

  function openFirst(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.enter('wikiLinkMarker');
    effects.consume(code);
    return openSecond;
  }

  function openSecond(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('wikiLinkMarker');
    return valueStart;
  }

  function valueStart(code: Code): State | undefined {
    if (
      code === null ||
      markdownLineEnding(code) ||
      code === LEFT_BRACKET ||
      code === RIGHT_BRACKET
    ) {
      return nok(code);
    }
    effects.enter('wikiLinkValue');
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (code === null || markdownLineEnding(code) || code === LEFT_BRACKET) return nok(code);
    if (size > MAX_WIKILINK_LENGTH) return nok(code);
    if (code === RIGHT_BRACKET) {
      effects.exit('wikiLinkValue');
      effects.enter('wikiLinkMarker');
      effects.consume(code);
      return closeSecond;
    }
    effects.consume(code);
    size += 1;
    return code === BACKSLASH ? escaped : value;
  }

  function escaped(code: Code): State | undefined {
    if (code === null || markdownLineEnding(code)) return nok(code);
    effects.consume(code);
    size += 1;
    return value;
  }

  function closeSecond(code: Code): State | undefined {
    if (code !== RIGHT_BRACKET) return nok(code);
    effects.consume(code);
    effects.exit('wikiLinkMarker');
    effects.exit('wikiLink');
    return ok;
  }
}

const wikiLinkConstruct: Construct = { name: 'wikiLink', tokenize: tokenizeWikiLink };

// ---------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------

/** Characters allowed in a tag name: letters, digits, `_`, `-`, `/` (no emoji, no punctuation). */
export function isTagCode(code: Code): boolean {
  if (code === null) return false;
  if (asciiAlphanumeric(code) || code === UNDERSCORE || code === DASH || code === SLASH)
    return true;
  if (code < 128) return false;
  // Surrogates (emoji and other astral characters) end a tag.
  if (code >= 0xd800 && code <= 0xdfff) return false;
  return !unicodeWhitespace(code) && !unicodePunctuation(code);
}

const GREATER_THAN = 62;
const SEMICOLON = 59;
const WHITESPACE_REFERENCE = /^&(#x0*(20|9|a0)|#0*(32|9|160)|nbsp);$/i;

/**
 * Tags start after whitespace, at a line start, right after inline HTML (`<br>#tag`), or after
 * a whitespace character reference (`&#x20;#tag`, how edge spaces are written in table cells).
 */
function previousAllowsTag(this: TokenizeContext, code: Code): boolean {
  return (
    code === null ||
    markdownLineEndingOrSpace(code) ||
    unicodeWhitespace(code) ||
    code === GREATER_THAN ||
    code === SEMICOLON
  );
}

/** True when the token right before is a whitespace character reference (`&#x20;`). */
function followsWhitespaceReference(context: TokenizeContext): boolean {
  const last = context.events[context.events.length - 1];
  return (
    last?.[1].type === 'characterReference' &&
    WHITESPACE_REFERENCE.test(context.sliceSerialize(last[1]))
  );
}

function tokenizeTag(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0;
  let hasNonDigit = false;
  const previous = this.previous;
  const afterHtml = this.events[this.events.length - 1]?.[1].type === 'htmlText';
  const afterSpaceReference = followsWhitespaceReference(this);
  return start;

  function start(code: Code): State | undefined {
    if (previous === GREATER_THAN && !afterHtml) return nok(code);
    if (previous === SEMICOLON && !afterSpaceReference) return nok(code);
    effects.enter('tag');
    effects.enter('tagMarker');
    effects.consume(code);
    effects.exit('tagMarker');
    return nameStart;
  }

  function nameStart(code: Code): State | undefined {
    if (!isTagCode(code)) return nok(code);
    effects.enter('tagName');
    return name(code);
  }

  function name(code: Code): State | undefined {
    if (isTagCode(code)) {
      size += 1;
      if (size > MAX_TAG_LENGTH) return nok(code);
      if (code !== null && !asciiDigit(code) && code !== SLASH) hasNonDigit = true;
      effects.consume(code);
      return name;
    }
    if (!hasNonDigit) return nok(code);
    effects.exit('tagName');
    effects.exit('tag');
    return ok(code);
  }
}

const tagConstruct: Construct = {
  name: 'tag',
  tokenize: tokenizeTag,
  previous: previousAllowsTag,
};

// ---------------------------------------------------------------------------------------------
// Block IDs
// ---------------------------------------------------------------------------------------------

function isBlockIdCode(code: Code): boolean {
  return code !== null && (asciiAlphanumeric(code) || code === DASH);
}

function previousAllowsBlockId(this: TokenizeContext, code: Code): boolean {
  return code === null || markdownLineEndingOrSpace(code) || code === SEMICOLON;
}

function tokenizeBlockId(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0;
  const previous = this.previous;
  const afterSpaceReference = followsWhitespaceReference(this);
  return start;

  function start(code: Code): State | undefined {
    // After `&#x20;` (a space that had to be encoded), like after a space.
    if (previous === SEMICOLON && !afterSpaceReference) return nok(code);
    effects.enter('blockId');
    effects.enter('blockIdMarker');
    effects.consume(code);
    effects.exit('blockIdMarker');
    return valueStart;
  }

  function valueStart(code: Code): State | undefined {
    if (!isBlockIdCode(code)) return nok(code);
    effects.enter('blockIdValue');
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (isBlockIdCode(code)) {
      size += 1;
      if (size > MAX_BLOCK_ID_LENGTH) return nok(code);
      effects.consume(code);
      return value;
    }
    effects.exit('blockIdValue');
    if (markdownSpace(code)) {
      effects.enter('blockIdSpace');
      return space(code);
    }
    return end(code);
  }

  function space(code: Code): State | undefined {
    if (markdownSpace(code)) {
      effects.consume(code);
      return space;
    }
    effects.exit('blockIdSpace');
    return end(code);
  }

  function end(code: Code): State | undefined {
    if (code !== null && !markdownLineEnding(code)) return nok(code);
    effects.exit('blockId');
    return ok(code);
  }
}

const blockIdConstruct: Construct = {
  name: 'blockId',
  tokenize: tokenizeBlockId,
  previous: previousAllowsBlockId,
};

// ---------------------------------------------------------------------------------------------
// Highlights (a copy of GFM strikethrough's attention logic with `==`)
// ---------------------------------------------------------------------------------------------

interface SequenceToken extends Token {
  _open?: boolean;
  _close?: boolean;
}

function sequenceSize(token: Token): number {
  return token.end.offset - token.start.offset;
}

const resolveAllHighlight: Resolver = (events, context) => {
  let index = -1;
  while (++index < events.length) {
    const closer = events[index];
    if (
      closer &&
      closer[0] === 'enter' &&
      closer[1].type === 'highlightSequenceTemporary' &&
      (closer[1] as SequenceToken)._close
    ) {
      let open = index;
      while (open--) {
        const opener = events[open];
        if (
          opener &&
          opener[0] === 'exit' &&
          opener[1].type === 'highlightSequenceTemporary' &&
          (opener[1] as SequenceToken)._open &&
          sequenceSize(closer[1]) === sequenceSize(opener[1])
        ) {
          closer[1].type = 'highlightSequence';
          opener[1].type = 'highlightSequence';
          const highlight: Token = {
            type: 'highlight',
            start: { ...opener[1].start },
            end: { ...closer[1].end },
          };
          const text: Token = {
            type: 'highlightText',
            start: { ...opener[1].end },
            end: { ...closer[1].start },
          };
          const nextEvents: Event[] = [
            ['enter', highlight, context],
            ['enter', opener[1], context],
            ['exit', opener[1], context],
            ['enter', text, context],
          ];
          const insideSpan = context.parser.constructs.insideSpan.null;
          if (insideSpan) {
            splice(
              nextEvents,
              nextEvents.length,
              0,
              resolveAll(insideSpan, events.slice(open + 1, index), context),
            );
          }
          splice(nextEvents, nextEvents.length, 0, [
            ['exit', text, context],
            ['enter', closer[1], context],
            ['exit', closer[1], context],
            ['exit', highlight, context],
          ]);
          splice(events, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - 2;
          break;
        }
      }
    }
  }
  for (const event of events) {
    if (event[1].type === 'highlightSequenceTemporary') event[1].type = 'data';
  }
  return events;
};

function tokenizeHighlight(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const previous = this.previous;
  const events = this.events;
  let size = 0;
  return start;

  function start(code: Code): State | undefined {
    const last = events[events.length - 1];
    if (previous === EQUALS && last?.[1].type !== 'characterEscape') return nok(code);
    effects.enter('highlightSequenceTemporary');
    return more(code);
  }

  function more(code: Code): State | undefined {
    const before = classifyCharacter(previous);
    if (code === EQUALS) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size += 1;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit('highlightSequenceTemporary') as SequenceToken;
    const after = classifyCharacter(code);
    token._open = !after || (after === 2 && Boolean(before));
    token._close = !before || (before === 2 && Boolean(after));
    return ok(code);
  }
}

const highlightConstruct: Construct = {
  name: 'highlight',
  tokenize: tokenizeHighlight,
  resolveAll: resolveAllHighlight,
};

/** The micromark extension with every Tessera construct. */
export function tesseraSyntax(): Extension {
  return {
    text: {
      [EXCLAMATION]: wikiLinkConstruct,
      [LEFT_BRACKET]: wikiLinkConstruct,
      [NUMBER_SIGN]: tagConstruct,
      [CARET]: blockIdConstruct,
      [EQUALS]: highlightConstruct,
    },
    insideSpan: { null: [highlightConstruct] },
    attentionMarkers: { null: [EQUALS] },
  };
}
