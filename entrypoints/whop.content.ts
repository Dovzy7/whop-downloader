import { browser } from 'wxt/browser';
import {
  DETECTION_CHANNEL,
  type DetectionCandidate,
  type DetectionSnapshotRequest,
} from '../lib/detection-channel';
import { buildMuxHlsUrl, createMediaItem } from '../lib/media';
import {
  MESSAGE,
  type DownloadBlobMessage,
  type MediaItem,
  type MediaSource,
  type ReportFrameMediaMessage,
  type ScanMediaResponse,
} from '../lib/messages';

type SearchRoot = Document | ShadowRoot;

const DETECTOR_SOURCES = new Set<MediaSource>([
  'video',
  'source',
  'mux-player',
  'mux-video',
  'metadata',
  'network',
  'performance',
  'closed-shadow',
  'blob',
]);

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

  const container = element.closest(
    'article, section, [role="dialog"], [class*="card" i], [class*="video" i]',
  );
  const heading = container?.querySelector(
    'h1, h2, h3, h4, [data-testid*="title" i], [class*="title" i]',
  );
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

function scanDom(): MediaItem[] {
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

    for (const element of root.querySelectorAll(
      'mux-player, mux-video, [playback-id], [data-playback-id]',
    )) {
      const playbackId =
        element.getAttribute('playback-id') || element.getAttribute('data-playback-id') || '';
      const explicitUrl = element.getAttribute('src') || element.getAttribute('cast-src');
      const url = explicitUrl || buildMuxHlsUrl(playbackId);
      if (!url) continue;

      addMedia(
        results,
        createMediaItem(url, {
          title: nearbyTitle(element),
          source: element.tagName.toLowerCase() === 'mux-video' ? 'mux-video' : 'mux-player',
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
  matches: ['https://whop.com/*', 'https://*.whop.com/*', 'https://*.mux.com/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main() {
    const passiveCandidates = new Map<string, MediaItem>();
    let scanTimer: ReturnType<typeof setTimeout> | null = null;

    const combinedScan = (): MediaItem[] => {
      const combined = new Map<string, MediaItem>();
      for (const item of scanDom()) addMedia(combined, item);
      for (const item of passiveCandidates.values()) addMedia(combined, item);
      return [...combined.values()];
    };

    const reportSnapshot = async (): Promise<ScanMediaResponse> => {
      const media = combinedScan();
      const report: ReportFrameMediaMessage = {
        type: MESSAGE.reportFrameMedia,
        media,
        pageTitle: document.title,
        pageUrl: location.href,
      };
      await browser.runtime.sendMessage(report).catch(() => undefined);
      return { success: true, media, pageTitle: document.title };
    };

    const scheduleScan = (delay = 120): void => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanTimer = null;
        void reportSnapshot();
      }, delay);
    };

    window.addEventListener('message', (event: MessageEvent<DetectionCandidate>) => {
      if (event.source !== window || event.data?.channel !== DETECTION_CHANNEL) return;
      if (event.data.type !== 'candidate' || typeof event.data.url !== 'string') return;
      const source = DETECTOR_SOURCES.has(event.data.source) ? event.data.source : 'network';
      const item = createMediaItem(event.data.url, {
        title: String(event.data.title || document.title || 'Whop video').slice(0, 240),
        source,
        poster: typeof event.data.poster === 'string' ? event.data.poster : undefined,
        duration:
          typeof event.data.duration === 'number' && Number.isFinite(event.data.duration)
            ? event.data.duration
            : undefined,
      });
      if (!item) return;
      passiveCandidates.set(item.id, item);
      scheduleScan();
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      const typed = message as { type?: string };
      if (typed.type === MESSAGE.scanMedia) {
        void reportSnapshot().then(sendResponse).catch((error: unknown) =>
          sendResponse({
            success: false,
            media: [],
            pageTitle: document.title,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return true;
      }
      if (typed.type === MESSAGE.downloadBlob) {
        const blobMessage = message as DownloadBlobMessage;
        if (!blobMessage.url.startsWith('blob:')) {
          sendResponse({ success: false, error: 'Invalid Blob URL.' });
          return;
        }
        const anchor = document.createElement('a');
        anchor.href = blobMessage.url;
        anchor.download = blobMessage.filename;
        anchor.style.display = 'none';
        (document.body || document.documentElement).append(anchor);
        anchor.click();
        anchor.remove();
        sendResponse({ success: true });
        return;
      }
    });

    const observer = new MutationObserver(() => scheduleScan(180));
    observer.observe(document, { subtree: true, childList: true, attributes: true });

    const snapshotRequest: DetectionSnapshotRequest = {
      channel: DETECTION_CHANNEL,
      type: 'request-snapshot',
    };
    window.postMessage(snapshotRequest, '*');
    scheduleScan(20);
  },
});
