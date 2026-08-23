const EXTENSION_BY_KIND = {
  direct: '.mp4',
  hls: '.mp4',
  dash: '.mp4',
  blob: '.mp4',
} as const;

export function sanitizeFilename(value: string, fallback = 'whop-video'): string {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140);

  return cleaned || fallback;
}

export function filenameForMedia(
  title: string,
  kind: keyof typeof EXTENSION_BY_KIND,
  sourceUrl?: string,
): string {
  const base = sanitizeFilename(title);
  let extension = EXTENSION_BY_KIND[kind];

  if (kind === 'direct' && sourceUrl) {
    try {
      const match = new URL(sourceUrl).pathname.match(/\.(mp4|m4v|mov|webm|mpeg|mpg)$/i);
      if (match?.[0]) extension = match[0].toLowerCase() as typeof extension;
    } catch {
      // Use the default extension.
    }
  }

  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}
