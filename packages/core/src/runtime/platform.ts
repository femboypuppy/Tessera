/** Where the app runs. */
export interface PlatformInfo {
  os: 'mac' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown';
  /** True inside the Tauri desktop app. */
  isDesktopApp: boolean;
  /** True on touch-first devices (coarse pointer). */
  isTouch: boolean;
  /** True on Apple platforms, where `Mod` means ⌘ instead of Ctrl. */
  isApple: boolean;
}

/**
 * Detects the platform from `navigator` (defaults to "unknown" outside browsers).
 *
 * @example
 * const { isApple } = detectPlatform(); // Mod = ⌘ when true
 */
export function detectPlatform(
  env: {
    navigator?: Partial<Navigator>;
    matchMedia?: (query: string) => { matches: boolean };
    tauri?: boolean;
  } = {},
): PlatformInfo {
  const nav = env.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const ua =
    `${nav?.userAgent ?? ''} ${(nav as { platform?: string } | undefined)?.platform ?? ''}`.toLowerCase();
  let os: PlatformInfo['os'] = 'unknown';
  if (/iphone|ipad|ipod/.test(ua)) os = 'ios';
  else if (/android/.test(ua)) os = 'android';
  else if (/mac/.test(ua)) os = 'mac';
  else if (/win/.test(ua)) os = 'windows';
  else if (/linux|x11|cros/.test(ua)) os = 'linux';
  const match =
    env.matchMedia ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : undefined);
  const isTouch = match ? match('(pointer: coarse)').matches : false;
  const isDesktopApp =
    env.tauri ?? (typeof globalThis === 'object' && '__TAURI_INTERNALS__' in globalThis);
  return { os, isDesktopApp, isTouch, isApple: os === 'mac' || os === 'ios' };
}
