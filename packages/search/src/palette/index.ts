/**
 * `@tessera/search/palette-host`: the light pieces the search feature registers statically (they
 * are part of the startup bundle). The palette dialog and the search page load on demand.
 */
export { PaletteHost } from './host';
export { paletteStore, usePaletteState } from './store';
export { pushRecent, readRecent } from './recent';
export { openSearch, searchUrl, SEARCH_PATH } from '../search-page/location';
