import {
  DETECTION_CHANNEL,
  type DetectionCandidate,
  type DetectionSnapshotRequest,
} from '../lib/detection-channel';
import type { MediaSource as DetectedMediaSource } from '../lib/messages';

type ObservableRoot = Document | ShadowRoot;

const MEDIA_URL_PATTERN = /\.(?:m3u8|mpd|mp4|m4v|mov|webm|mpeg|mpg)(?:$|[?#])/i;

export default defineContentScript({
  matches: ['https://whop.com/*', 'https://*.whop.com/*', 'https://*.mux.com/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const candidates = new Map<string, DetectionCandidate>();
    const observedRoots = new WeakSet<ObservableRoot>();
    const rootScanTimers = new WeakMap<ObservableRoot, number>();
    const blobUrls = new Set<string>();

    const titleFor = (element?: Element | null): string => {
      if (!element) return document.title || 'Whop video';
      const explicit =
        element.getAttribute('title') ||
        element.getAttribute('aria-label') ||
        element.getAttribute('data-title');
      if (explicit?.trim()) return explicit.trim().slice(0, 240);
      const container = element.closest(
        'article, section, [role="dialog"], [class*="card" i], [class*="video" i]',
      );
      const heading = container?.querySelector(
        'h1, h2, h3, h4, [data-testid*="title" i], [class*="title" i]',
      );
      return heading?.textContent?.trim().slice(0, 240) || document.title || 'Whop video';
    };

    const normalizeCandidate = (value: string): string | null => {
      const candidate = String(value || '').trim();
      if (!candidate) return null;
      if (candidate.startsWith('blob:')) return blobUrls.has(candidate) ? candidate : null;
      try {
        const url = new URL(candidate, location.href);
        if (url.protocol !== 'https:' || !MEDIA_URL_PATTERN.test(url.href)) return null;
        return url.href;
      } catch {
        return null;
      }
    };

    const publish = (
      value: string,
      source: DetectedMediaSource,
      element?: Element | null,
      overrides: Partial<DetectionCandidate> = {},
    ): void => {
      const url = normalizeCandidate(value);
      if (!url) return;
      const candidate: DetectionCandidate = {
        channel: DETECTION_CHANNEL,
        type: 'candidate',
        url,
        title: titleFor(element),
        source,
        ...overrides,
      };
      candidates.set(url, candidate);
      window.postMessage(candidate, '*');
    };

    const muxUrl = (playbackId: string): string | null => {
      const value = String(playbackId || '').trim();
      if (!value) return null;
      const queryIndex = value.indexOf('?');
      const id = (queryIndex >= 0 ? value.slice(0, queryIndex) : value).replace(
        /[^a-zA-Z0-9_-]/g,
        '',
      );
      const query = queryIndex >= 0 ? value.slice(queryIndex + 1) : '';
      return id ? `https://stream.mux.com/${id}.m3u8${query ? `?${query}` : ''}` : null;
    };

    const scanRoot = (root: ObservableRoot, closed = false): void => {
      const sourceForElement: DetectedMediaSource = closed ? 'closed-shadow' : 'video';
      for (const video of root.querySelectorAll<HTMLVideoElement>('video')) {
        const poster = video.poster || undefined;
        const duration = Number.isFinite(video.duration) ? video.duration : undefined;
        if (video.currentSrc) publish(video.currentSrc, sourceForElement, video, { poster, duration });
        if (video.src) publish(video.src, sourceForElement, video, { poster, duration });
        for (const source of video.querySelectorAll<HTMLSourceElement>('source[src]')) {
          publish(source.src, closed ? 'closed-shadow' : 'source', video, { poster, duration });
        }
      }

      for (const element of root.querySelectorAll(
        'mux-player, mux-video, [playback-id], [data-playback-id]',
      )) {
        const playbackId =
          element.getAttribute('playback-id') || element.getAttribute('data-playback-id') || '';
        const explicitUrl = element.getAttribute('src') || element.getAttribute('cast-src');
        const url = explicitUrl || muxUrl(playbackId);
        if (url) {
          publish(url, closed ? 'closed-shadow' : 'mux-player', element, {
            poster: element.getAttribute('poster') || undefined,
          });
        }
      }
    };

    const scheduleRootScan = (root: ObservableRoot, closed = false): void => {
      const existingTimer = rootScanTimers.get(root);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        rootScanTimers.delete(root);
        scanRoot(root, closed);
      }, 100);
      rootScanTimers.set(root, timer);
    };

    const observeRoot = (root: ObservableRoot, closed = false): void => {
      if (observedRoots.has(root)) return;
      observedRoots.add(root);
      scanRoot(root, closed);
      const observer = new MutationObserver(() => scheduleRootScan(root, closed));
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['src', 'playback-id', 'data-playback-id', 'cast-src'],
      });
    };

    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit): ShadowRoot {
      const root = originalAttachShadow.call(this, init);
      observeRoot(root, init.mode === 'closed');
      return root;
    };

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((object: Blob | MediaSource): string => {
      const url = originalCreateObjectUrl(object);
      if (object instanceof Blob) {
        blobUrls.add(url);
        if (/^(?:video|audio)\//i.test(object.type)) {
          publish(url, 'blob', null, { title: document.title || 'Whop media' });
        }
      }
      return url;
    }) as typeof URL.createObjectURL;

    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = ((url: string): void => {
      blobUrls.delete(url);
      originalRevokeObjectUrl(url);
    }) as typeof URL.revokeObjectURL;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
      const request = args[0];
      const requestedUrl =
        typeof request === 'string' || request instanceof URL ? String(request) : request.url;
      publish(requestedUrl, 'network');
      const response = await originalFetch(...args);
      publish(response.url, 'network');
      return response;
    }) as typeof window.fetch;

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      publish(String(url), 'network');
      this.addEventListener('load', () => publish(this.responseURL, 'network'), { once: true });
      const callable = originalXhrOpen as (...args: unknown[]) => void;
      callable.call(this, method, url, ...rest);
    } as typeof originalXhrOpen;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) publish(entry.name, 'performance');
      });
      observer.observe({ type: 'resource', buffered: true });
      for (const entry of performance.getEntriesByType('resource')) {
        publish(entry.name, 'performance');
      }
    } catch {
      // PerformanceObserver is an optional fallback; DOM and network hooks continue to work.
    }

    window.addEventListener('message', (event: MessageEvent<DetectionSnapshotRequest>) => {
      if (event.source !== window || event.data?.channel !== DETECTION_CHANNEL) return;
      if (event.data.type !== 'request-snapshot') return;
      scanRoot(document);
      for (const candidate of candidates.values()) window.postMessage(candidate, '*');
    });

    observeRoot(document);
  },
});
