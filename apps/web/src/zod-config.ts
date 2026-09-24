import { z } from 'zod';

/**
 * Imported first by `main.tsx`, before any schema is parsed. Zod compiles object parsers with
 * `new Function` unless told not to, after probing whether `eval` works. The app's CSP forbids
 * `eval` (the server's and the desktop app's), so the probe only produced a CSP violation there:
 * validation takes the same eval-free path everywhere.
 */
z.config({ jitless: true });
