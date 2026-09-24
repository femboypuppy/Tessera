import type { SettingDefinition, SettingsSchema } from './types';

/** Setting keys: an identifier of at most 64 characters. */
export const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Most settings one plugin can declare. */
export const MAX_SETTINGS = 50;

/** Default and largest `maxLength` of string settings. */
export const DEFAULT_STRING_SETTING_LENGTH = 1_000;
export const MAX_STRING_SETTING_LENGTH = 10_000;

/** A setting value: settings are strings, numbers or booleans. */
export type SettingPrimitive = string | number | boolean;

/** The result of {@link validateSettingValue}. */
export type SettingValidation =
  { ok: true; value: SettingPrimitive } | { ok: false; error: string };

/**
 * Checks a value against its setting definition.
 *
 * @example
 * validateSettingValue({ type: 'number', label: 'Minutes', default: 25, min: 1 }, 0);
 * // { ok: false, error: 'Must be at least 1' }
 */
export function validateSettingValue(
  definition: SettingDefinition,
  value: unknown,
): SettingValidation {
  switch (definition.type) {
    case 'string': {
      if (typeof value !== 'string') return { ok: false, error: 'Must be text' };
      const max = Math.min(
        definition.maxLength ?? DEFAULT_STRING_SETTING_LENGTH,
        MAX_STRING_SETTING_LENGTH,
      );
      if (value.length > max) return { ok: false, error: `Must be at most ${max} characters` };
      return { ok: true, value };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { ok: false, error: 'Must be a number' };
      if (definition.min !== undefined && value < definition.min)
        return { ok: false, error: `Must be at least ${definition.min}` };
      if (definition.max !== undefined && value > definition.max)
        return { ok: false, error: `Must be at most ${definition.max}` };
      return { ok: true, value };
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, error: 'Must be true or false' };
    case 'select':
      return typeof value === 'string' && definition.options.some((o) => o.value === value)
        ? { ok: true, value }
        : {
            ok: false,
            error: `Must be one of: ${definition.options.map((o) => o.value).join(', ')}`,
          };
  }
}

/** Every setting at its default value. */
export function defaultSettingsValues(schema: SettingsSchema): Record<string, SettingPrimitive> {
  const values: Record<string, SettingPrimitive> = {};
  for (const [key, definition] of Object.entries(schema)) values[key] = definition.default;
  return values;
}

/**
 * The effective values: stored values that are still valid, defaults for everything else (so a
 * plugin update that changes a setting's type never breaks it).
 */
export function resolveSettingsValues(
  schema: SettingsSchema,
  stored: Readonly<Record<string, unknown>>,
): Record<string, SettingPrimitive> {
  const values = defaultSettingsValues(schema);
  for (const [key, definition] of Object.entries(schema)) {
    if (!Object.hasOwn(stored, key)) continue;
    const result = validateSettingValue(definition, stored[key]);
    if (result.ok) values[key] = result.value;
  }
  return values;
}
