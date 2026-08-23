import { browser } from 'wxt/browser';
import { buildMuxHlsUrl, createMediaItem } from '../lib/media';
import { MESSAGE, type MediaItem, type ScanMediaResponse } from '../lib/messages';

type SearchRoot = Document | ShadowRoot;

function collectSearchRoots(): SearchRoot[] {
  const roots: SearchRoot[] = [document];
  const seen = new Set<SearchRoot>(roots);

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    if (!root) continue;
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) {
        seen.add(element.shadowRoot);
        roots.push(element.shadowRoot);
      }
    }
  }

  return roots;
}

function nearbyTitle(element: Element): string {
  const explicit =
    element.getAttribute('title') ||
    element.getAttribute('aria-label') ||
    element.getAttribute('data-title');
  if (explicit?.trim()) return explicit.trim();

  const container = element.closest('article, section, [role="dialog"], [class*="card" i]');
  const heading = container?.querySelector('h1, h2, h3, h4, [data-testid*="title" i]');
  return heading?.textContent?.trim() || document.title || 'Whop video';
}

function addMedia(target: Map<string, MediaItem>, item: MediaItem | null): void {
  if (!item) return;
  const existing = target.get(item.id);
  if (!existing || (!existing.poster && item.poster)) target.set(item.id, item);
}

function posterFor(element: Element): string | undefined {
  if (element instanceof HTMLVideoElement && element.poster) return element.poster;
  return element.getAttribute('poster') || undefined;
}

function scanPage(): MediaItem[] {
  const results = new Map<string, MediaItem>();
  const roots = collectSearchRoots();

  for (const root of roots) {
    for (const video of root.querySelectorAll('video')) {
      const candidates = new Set<string>();
      if (video.currentSrc) candidates.add(video.currentSrc);
      if (video.src) candidates.add(video.src);
      for (const source of video.querySelectorAll<HTMLSourceElement>('source[src]')) {
        if (source.src) candidates.add(source.src);
      }

      for (const url of candidates) {
        addMedia(
          results,
          createMediaItem(url, {
            title: nearbyTitle(video),
            source: 'video',
            poster: posterFor(video),
            duration: Number.isFinite(video.duration) ? video.duration : undefined,
          }),
        );
      }
    }

    for (const element of root.querySelectorAll('mux-player, mux-video')) {
      const playbackId =
        element.getAttribute('playback-id') || element.getAttribute('data-playback-id') || '';
      const explicitUrl = element.getAttribute('src') || element.getAttribute('cast-src');
      const url = explicitUrl || buildMuxHlsUrl(playbackId);
      if (!url) continue;

      addMedia(
        results,
        createMediaItem(url, {
          title: nearbyTitle(element),
          source: element.tagName.toLowerCase() === 'mux-player' ? 'mux-player' : 'mux-video',
          poster: posterFor(element),
        }),
      );
    }

    for (const meta of root.querySelectorAll<HTMLMetaElement>(
      'meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]',
    )) {
      if (!meta.content) continue;
      addMedia(
        results,
        createMediaItem(meta.content, {
          title: document.title || 'Whop video',
          source: 'metadata',
        }),
      );
    }
  }

  return [...results.values()];
}

export default defineContentScript({
  matches: ['https://whop.com/*', 'https://*.whop.com/*'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      if ((message as { type?: string }).type !== MESSAGE.scanMedia) return;

      const response: ScanMediaResponse = {
        success: true,
        media: scanPage(),
        pageTitle: document.title,
      };
      return Promise.resolve(response);
    });
  },
});
