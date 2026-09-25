import { type PageCover, type PageMeta } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  cn,
  COVER_PRESETS,
  coverPresetBackground,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tessera/ui';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { t } from '../../i18n';

/** The cover picker's contents: preset covers and an upload (loaded when the picker opens). */
export default function CoverPickerContent({
  page,
  setCover,
}: {
  page: PageMeta;
  setCover: (cover: PageCover | null) => void;
}) {
  const ctx = useAppContext();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <Tabs defaultValue="gallery">
      <TabsList className="px-2 pt-1">
        <TabsTrigger value="gallery">{t('coverGallery')}</TabsTrigger>
        <TabsTrigger value="upload">{t('uploadCover')}</TabsTrigger>
        {page.cover ? (
          <button
            type="button"
            onClick={() => setCover(null)}
            className="ml-auto h-8 rounded-md px-2 text-ui text-fg-muted hover:bg-hover hover:text-fg"
          >
            {t('removeCover')}
          </button>
        ) : null}
      </TabsList>
      <TabsContent value="gallery" className="grid grid-cols-4 gap-2 p-3">
        {Object.keys(COVER_PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            onClick={() => setCover({ kind: 'preset', value: name })}
            className={cn(
              'duration-fast h-12 rounded-md ring-offset-2 ring-offset-surface transition-transform hover:scale-[1.03]',
              page.cover?.kind === 'preset' && page.cover.value === name && 'ring-2 ring-accent',
            )}
            style={{ background: coverPresetBackground(name) }}
          />
        ))}
      </TabsContent>
      <TabsContent value="upload" className="p-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          className="sr-only"
          aria-label={t('uploadCover')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void ctx.services.assetStore
              .put(file)
              .then(({ assetId }) => setCover({ kind: 'asset', value: assetId }));
          }}
        />
        <Button className="w-full" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" />
          {t('uploadCover')}
        </Button>
      </TabsContent>
    </Tabs>
  );
}
