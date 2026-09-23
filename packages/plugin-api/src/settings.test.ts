import { describe, expect, it } from 'vitest';
import {
  defaultSettingsValues,
  resolveSettingsValues,
  validateSettingValue,
  MAX_STRING_SETTING_LENGTH,
} from './settings';
import type { SettingsSchema } from './types';

const schema = {
  format: { type: 'string', label: 'Format', default: 'YYYY-MM-DD', maxLength: 20 },
  minutes: { type: 'number', label: 'Minutes', default: 25, min: 1, max: 120 },
  auto: { type: 'boolean', label: 'Auto', default: false },
  mode: {
    type: 'select',
    label: 'Mode',
    default: 'focus',
    options: [
      { value: 'focus', label: 'Focus' },
      { value: 'break', label: 'Break' },
    ],
  },
} satisfies SettingsSchema;

describe('validateSettingValue', () => {
  it('accepts valid values of every type', () => {
    expect(validateSettingValue(schema.format, 'DD/MM')).toEqual({ ok: true, value: 'DD/MM' });
    expect(validateSettingValue(schema.minutes, 50)).toEqual({ ok: true, value: 50 });
    expect(validateSettingValue(schema.auto, true)).toEqual({ ok: true, value: true });
    expect(validateSettingValue(schema.mode, 'break')).toEqual({ ok: true, value: 'break' });
  });

  it.each([
    ['a number for a string', schema.format, 5],
    ['a string over maxLength', schema.format, 'x'.repeat(21)],
    ['a number below min', schema.minutes, 0],
    ['a number above max', schema.minutes, 121],
    ['NaN', schema.minutes, Number.NaN],
    ['Infinity', schema.minutes, Number.POSITIVE_INFINITY],
    ['a string for a number', schema.minutes, '5'],
    ['a string for a boolean', schema.auto, 'true'],
    ['an unknown option', schema.mode, 'nap'],
    ['an object', schema.mode, { value: 'focus' }],
  ])('rejects %s', (_label, definition, value) => {
    expect(validateSettingValue(definition, value).ok).toBe(false);
  });

  it('caps maxLength at the hard limit', () => {
    const long = { type: 'string', label: 'Notes', default: '', maxLength: 1e9 } as const;
    expect(validateSettingValue(long, 'x'.repeat(MAX_STRING_SETTING_LENGTH)).ok).toBe(true);
    expect(validateSettingValue(long, 'x'.repeat(MAX_STRING_SETTING_LENGTH + 1)).ok).toBe(false);
  });
});

describe('resolveSettingsValues', () => {
  it('fills defaults and keeps valid stored values', () => {
    expect(defaultSettingsValues(schema)).toEqual({
      format: 'YYYY-MM-DD',
      minutes: 25,
      auto: false,
      mode: 'focus',
    });
    expect(resolveSettingsValues(schema, { minutes: 50, auto: true })).toEqual({
      format: 'YYYY-MM-DD',
      minutes: 50,
      auto: true,
      mode: 'focus',
    });
  });

  it('falls back to defaults for stale or invalid values and ignores unknown keys', () => {
    expect(resolveSettingsValues(schema, { minutes: 'soon', mode: 'nap', removed: 'x' })).toEqual(
      defaultSettingsValues(schema),
    );
  });
});
