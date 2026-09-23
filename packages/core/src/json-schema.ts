import { z } from 'zod';
import type { JsonObject, JsonValue } from './json';

// zod schemas live apart from the plain helpers in `json.ts`, so code on the startup path can
// validate JSON without pulling zod into the shell bundle.

/**
 * zod schema for {@link JsonValue}. Rejects `undefined`, functions, class instances,
 * non-finite numbers and cyclic structures.
 *
 * @example
 * jsonValueSchema.parse({ a: [1, 'two', null] }); // ok
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine(Number.isFinite, 'Numbers must be finite'),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** zod schema for {@link JsonObject}. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
