import type { SettingDefinition } from '@tessera/plugin-api';
import { resolveSettingsValues, type SettingPrimitive } from '@tessera/plugin-api/settings';
import { Button, Field, Input, Label, Select, Switch, Textarea } from '@tessera/ui';
import { RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { t } from '../../i18n';
import type { PluginManager } from '../../manager';
import type { InstalledPlugin } from '../../store/types';

function TextSetting({
  definition,
  value,
  onCommit,
}: {
  definition: Extract<SettingDefinition, { type: 'string' | 'number' }>;
  value: SettingPrimitive;
  onCommit(value: SettingPrimitive): Promise<string | null>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = async () => {
    if (draft === String(value)) return;
    const next = definition.type === 'number' ? Number(draft) : draft;
    if (definition.type === 'number' && (draft.trim() === '' || !Number.isFinite(next))) {
      setError(t('invalidNumber'));
      return;
    }
    setError(await onCommit(next));
  };
  return (
    <Field label={definition.label} description={definition.description} error={error ?? undefined}>
      {(props) =>
        definition.type === 'string' && definition.multiline ? (
          <Textarea
            {...props}
            value={draft}
            placeholder={definition.placeholder}
            maxLength={definition.maxLength}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            className="max-w-xl font-mono text-ui"
          />
        ) : (
          <div className="flex max-w-xs items-center gap-2">
            <Input
              {...props}
              value={draft}
              type={definition.type === 'number' ? 'number' : 'text'}
              inputMode={definition.type === 'number' ? 'decimal' : undefined}
              min={definition.type === 'number' ? definition.min : undefined}
              max={definition.type === 'number' ? definition.max : undefined}
              step={definition.type === 'number' ? (definition.step ?? 1) : undefined}
              placeholder={definition.type === 'string' ? definition.placeholder : undefined}
              maxLength={definition.type === 'string' ? definition.maxLength : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commit();
              }}
            />
            {definition.type === 'number' && definition.unit ? (
              <span className="text-ui text-fg-muted">{definition.unit}</span>
            ) : null}
          </div>
        )
      }
    </Field>
  );
}

function BooleanSetting({
  definition,
  value,
  onCommit,
}: {
  definition: Extract<SettingDefinition, { type: 'boolean' }>;
  value: boolean;
  onCommit(value: boolean): void;
}) {
  const id = useId();
  return (
    <div className="flex max-w-xl items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{definition.label}</Label>
        {definition.description ? (
          <p id={`${id}-description`} className="mt-0.5 text-xs text-fg-muted">
            {definition.description}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={value}
        aria-describedby={definition.description ? `${id}-description` : undefined}
        onCheckedChange={onCommit}
      />
    </div>
  );
}

/** The settings form a plugin declared, generated from its schema. */
export function SettingsForm({
  plugin,
  manager,
}: {
  plugin: InstalledPlugin;
  manager: PluginManager;
}) {
  const schema = plugin.settingsSchema;
  if (!schema) {
    return (
      <p className="text-ui text-fg-muted">
        {plugin.enabled
          ? t('noSettings', { plugin: plugin.manifest.name })
          : t('settingsUnknown', { plugin: plugin.manifest.name })}
      </p>
    );
  }
  const values = resolveSettingsValues(schema, plugin.settings);
  const commit = async (key: string, value: SettingPrimitive): Promise<string | null> => {
    try {
      await manager.setSetting(plugin.id, key, value);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const changed = Object.keys(plugin.settings).length > 0;
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
      {Object.entries(schema).map(([key, definition]) => {
        const value = values[key] ?? definition.default;
        if (definition.type === 'boolean')
          return (
            <BooleanSetting
              key={key}
              definition={definition}
              value={value === true}
              onCommit={(next) => void commit(key, next)}
            />
          );
        if (definition.type === 'select')
          return (
            <Field key={key} label={definition.label} description={definition.description}>
              {(props) => (
                <Select
                  id={props.id}
                  aria-describedby={props['aria-describedby']}
                  value={String(value)}
                  onValueChange={(next) => void commit(key, next)}
                  options={definition.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  className="max-w-xs"
                />
              )}
            </Field>
          );
        return (
          <TextSetting
            key={key}
            definition={definition}
            value={value}
            onCommit={(next) => commit(key, next)}
          />
        );
      })}
      {changed ? (
        <div>
          <Button size="sm" onClick={() => void manager.resetSettings(plugin.id)}>
            <RotateCcw aria-hidden="true" />
            {t('resetSettings')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
