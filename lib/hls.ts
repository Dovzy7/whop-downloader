export interface HlsVariant {
  url: string;
  bandwidth: number;
  resolution?: string;
}

export interface HlsMediaPlaylist {
  segments: string[];
  initSegment?: string;
  encrypted: boolean;
  usesByteRanges: boolean;
}

function parseAttributeList(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const matcher = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(value)) !== null) {
    const key = match[1];
    const raw = match[2];
    if (!key || raw === undefined) continue;
    result[key.toUpperCase()] = raw.replace(/^"|"$/g, '');
  }

  return result;
}

function resolveUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).href;
}

export function parseHlsVariants(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line?.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
    const nextLine = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith('#'));
    if (!nextLine) continue;
    variants.push({
      url: resolveUrl(nextLine, baseUrl),
      bandwidth: Number.parseInt(attributes.BANDWIDTH ?? '0', 10) || 0,
      resolution: attributes.RESOLUTION,
    });
  }

  return variants;
}

export function selectBestHlsVariant(variants: HlsVariant[]): HlsVariant | null {
  return variants.reduce<HlsVariant | null>(
    (best, variant) => (!best || variant.bandwidth > best.bandwidth ? variant : best),
    null,
  );
}

export function parseHlsMediaPlaylist(text: string, baseUrl: string): HlsMediaPlaylist {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const segments: string[] = [];
  let initSegment: string | undefined;
  let encrypted = false;
  let usesByteRanges = false;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
      if (attributes.URI) initSegment = resolveUrl(attributes.URI, baseUrl);
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
      encrypted = Boolean(attributes.METHOD && attributes.METHOD !== 'NONE');
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE')) {
      usesByteRanges = true;
      continue;
    }
    if (!line.startsWith('#')) segments.push(resolveUrl(line, baseUrl));
  }

  return { segments, initSegment, encrypted, usesByteRanges };
}

export function isHlsMasterPlaylist(text: string): boolean {
  return text.includes('#EXT-X-STREAM-INF:');
}
