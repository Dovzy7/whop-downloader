import type { MediaItem, MediaKind } from './messages';

const DIRECT_MEDIA_EXTENSION = /\.(?:mp4|m4v|mov|webm|mpeg|mpg)(?:$|[?#])/i;

export function classifyMediaUrl(url: string): MediaKind | null {
  if (String(url || '').trim().startsWith('blob:')) return 'blob';
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (/\.m3u8(?:$|[?#])/.test(lower)) return 'hls';
  if (/\.mpd(?:$|[?#])/.test(lower)) return 'dash';
  if (DIRECT_MEDIA_EXTENSION.test(lower)) return 'direct';
  return null;
}

export function normalizeMediaUrl(value: string, base = globalThis.location?.href): string | null {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.startsWith('data:')) return null;

  if (candidate.startsWith('blob:')) {
    try {
      const embeddedUrl = new URL(candidate.slice('blob:'.length));
      if (embeddedUrl.protocol !== 'https:') return null;
      return candidate;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(candidate, base);
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function buildMuxHlsUrl(playbackId: string): string | null {
  const value = String(playbackId || '').trim();
  if (!value) return null;

  const queryIndex = value.indexOf('?');
  const rawId = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  const query = queryIndex >= 0 ? value.slice(queryIndex + 1) : '';
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;
  return `https://stream.mux.com/${safeId}.m3u8${query ? `?${query}` : ''}`;
}

export function mediaId(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `media_${(hash >>> 0).toString(36)}`;
}

export function createMediaItem(
  url: string,
  details: Omit<MediaItem, 'id' | 'url' | 'kind'>,
): MediaItem | null {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return null;
  const kind = classifyMediaUrl(normalized);
  if (!kind) return null;

  return {
    ...details,
    id: mediaId(normalized),
    url: normalized,
    kind,
  };
}
