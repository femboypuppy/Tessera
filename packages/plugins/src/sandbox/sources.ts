import { uiInnerBootstrap, uiOuterBootstrap, workerFrameBootstrap } from './bootstraps';
import { createRuntimeKit } from './runtime-kit';
import { runUi } from './runtime-ui';
import { runWorker } from './runtime-worker';

/**
 * Assembles the sandbox documents and scripts from the self-contained functions in this folder.
 * Plugin code and the runtime travel to the sandbox in messages and load from blob URLs, so the
 * only inline script of each document is its bootstrap (allowed by a per-frame CSP nonce).
 */

/**
 * Imports a module from source text. Kept as a string: Vite rewrites `import(variable)` during
 * development, which would make it depend on a helper outside the sandbox.
 */
export const LOAD_MODULE_SOURCE =
  "function (source) { var url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); return import(url).finally(function () { URL.revokeObjectURL(url); }); }";

/** The classic worker script: installs the runtime when the frame hands over the port. */
export function workerScriptSource(): string {
  return [
    '"use strict";',
    'self.onmessage = function (event) {',
    '  self.onmessage = null;',
    '  var data = event.data || {};',
    `  var kit = (${createRuntimeKit.toString()})();`,
    `  var load = ${LOAD_MODULE_SOURCE};`,
    `  (${runWorker.toString()})({ port: data.port, code: data.code, init: data.init, importPlugin: load, console: self.console, global: self }, kit);`,
    '};',
  ].join('\n');
}

/** The UI runtime as an ES module: `export default function start(env)`. */
export function uiRuntimeModuleSource(): string {
  return [
    'export default function start(env) {',
    `  var kit = (${createRuntimeKit.toString()})();`,
    `  return (${runUi.toString()})(env, kit);`,
    '}',
  ].join('\n');
}

/** What a sandbox may reach over the network. */
export interface CspOptions {
  nonce: string;
  /** CSP host sources from granted `network:` permissions (`https://api.example.com`). */
  network: readonly string[];
}

/**
 * The Content Security Policy of every sandbox document. Nothing loads except the nonce'd
 * bootstrap, blob modules the bootstrap creates, inline styles, and data/blob images and fonts.
 * Network access is limited to granted domains; frames are forbidden, which also blocks every
 * navigation of a nested frame (the UI frames rely on this).
 */
export function buildCsp({ nonce, network }: CspOptions): string {
  const https = network.filter((source) => source.startsWith('https://'));
  const connect = network.length ? network.join(' ') : "'none'";
  const media = ['data:', 'blob:', ...https].join(' ');
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob:`,
    'worker-src blob:',
    `connect-src ${connect}`,
    `img-src ${media}`,
    `media-src ${media}`,
    "style-src 'unsafe-inline'",
    'font-src data: blob:',
    "frame-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** A sandbox document with one inline script. */
export function sandboxDocument({
  csp,
  nonce,
  script,
  fill = true,
}: {
  csp: string;
  nonce: string;
  script: string;
  /** Fill the frame without scrolling (outer frames); the inner frame styles itself. */
  fill?: boolean;
}): string {
  if (/<\/script/i.test(script)) throw new Error('A bootstrap script must not contain </script>');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`,
    '<meta name="referrer" content="no-referrer">',
    fill
      ? '<style>html,body{margin:0;padding:0;height:100%;background:transparent;overflow:hidden}</style>'
      : '<style>html,body{margin:0;padding:0;background:transparent}</style>',
    `</head><body><script nonce="${escapeAttribute(nonce)}">${script}</script></body></html>`,
  ].join('');
}

/** The logic frame's document. */
export function workerFrameDocument(options: CspOptions): string {
  return sandboxDocument({
    csp: buildCsp(options),
    nonce: options.nonce,
    script: `(${workerFrameBootstrap.toString()})();`,
  });
}

/** The outer UI frame's document. */
export function uiOuterDocument(options: CspOptions): string {
  return sandboxDocument({
    csp: buildCsp(options),
    nonce: options.nonce,
    script: `(${uiOuterBootstrap.toString()})();`,
  });
}

/** The inner UI frame's document (same CSP and nonce as its outer frame). */
export function uiInnerDocument(options: CspOptions): string {
  return sandboxDocument({
    csp: buildCsp(options),
    nonce: options.nonce,
    script: `(${uiInnerBootstrap.toString()})(${LOAD_MODULE_SOURCE});`,
    fill: false,
  });
}

/** A random CSP nonce. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}
