import { browser } from 'wxt/browser';
import { filenameForMedia } from '../lib/filename';
import {
  isMediaItem,
  MESSAGE,
  type DownloadCompleteMessage,
  type DownloadFailedMessage,
  type DownloadProgressMessage,
  type GetTabMediaMessage,
  type MediaItem,
  type ProcessHlsMessage,
  type ReportFrameMediaMessage,
  type ScanMediaResponse,
  type StartDownloadMessage,
} from '../lib/messages';

interface DirectDownloadJob {
  jobId: string;
  item: MediaItem;
  filename: string;
}

interface FrameMediaSnapshot {
  media: MediaItem[];
  pageTitle: string;
  pageUrl: string;
  updatedAt: number;
}

const directJobs = new Map<number, DirectDownloadJob>();
const tabFrameMedia = new Map<number, Map<number, FrameMediaSnapshot>>();
let creatingOffscreenDocument: Promise<void> | null = null;
let offscreenCloseTimer: ReturnType<typeof setTimeout> | null = null;

function createJobId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function assertDownloadableUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS media URLs are supported.');
}

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenUrl = browser.runtime.getURL('/offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCloseTimer) {
    clearTimeout(offscreenCloseTimer);
    offscreenCloseTimer = null;
  }
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreenDocument) return creatingOffscreenDocument;

  creatingOffscreenDocument = (async () => {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Create a local MP4 blob from authorized HLS media.',
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await browser.runtime.sendMessage({ type: MESSAGE.pingOffscreen });
        if (response?.ready) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw lastError instanceof Error ? lastError : new Error('The media processor did not start.');
  })().finally(() => {
    creatingOffscreenDocument = null;
  });

  return creatingOffscreenDocument;
}

function scheduleOffscreenClose(): void {
  if (offscreenCloseTimer) clearTimeout(offscreenCloseTimer);
  offscreenCloseTimer = setTimeout(() => {
    offscreenCloseTimer = null;
    void hasOffscreenDocument()
      .then((exists) => (exists ? chrome.offscreen.closeDocument() : undefined))
      .catch(() => undefined);
  }, 30_000);
}

async function startDirectDownload(item: MediaItem, jobId: string): Promise<void> {
  const filename = filenameForMedia(item.title, item.kind, item.url);
  const downloadId = await browser.downloads.download({
    url: item.url,
    filename,
    saveAs: false,
  });
  directJobs.set(downloadId, { jobId, item, filename });

  const progress: DownloadProgressMessage = {
    type: MESSAGE.downloadProgress,
    jobId,
    mediaId: item.id,
    percentage: 5,
    status: 'Download started in Chrome',
  };
  await browser.runtime.sendMessage(progress).catch(() => undefined);
}

async function startHlsDownload(item: MediaItem, jobId: string): Promise<void> {
  await ensureOffscreenDocument();
  const message: ProcessHlsMessage = {
    type: MESSAGE.processHls,
    jobId,
    item,
  };
  await browser.runtime.sendMessage(message);
}

async function startBlobDownload(item: MediaItem, tabId: number, jobId: string): Promise<void> {
  if (!item.url.startsWith('blob:')) throw new Error('Invalid Blob media URL.');
  if (!Number.isInteger(item.frameId)) throw new Error('The Blob media frame is unavailable.');
  const filename = filenameForMedia(item.title, 'blob', item.url);
  const response = (await browser.tabs.sendMessage(
    tabId,
    { type: MESSAGE.downloadBlob, url: item.url, filename },
    { frameId: item.frameId },
  )) as { success?: boolean; error?: string } | undefined;
  if (!response?.success) throw new Error(response?.error || 'The page could not save this Blob.');

  const complete: DownloadCompleteMessage = {
    type: MESSAGE.downloadComplete,
    jobId,
    mediaId: item.id,
    filename,
  };
  await browser.runtime.sendMessage(complete).catch(() => undefined);
}

function recordFrameMedia(message: ReportFrameMediaMessage, tabId: number, frameId: number) {
  const media = (Array.isArray(message.media) ? message.media : [])
    .filter(isMediaItem)
    .slice(0, 250)
    .map((item) => ({ ...item, frameId }));
  let frames = tabFrameMedia.get(tabId);
  if (!frames) {
    frames = new Map();
    tabFrameMedia.set(tabId, frames);
  }
  frames.set(frameId, {
    media,
    pageTitle: String(message.pageTitle || '').slice(0, 300),
    pageUrl: String(message.pageUrl || '').slice(0, 2_000),
    updatedAt: Date.now(),
  });
  return { success: true };
}

async function getTabMedia(message: GetTabMediaMessage): Promise<ScanMediaResponse> {
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId)) {
    return { success: false, media: [], pageTitle: '', error: 'Invalid tab.' };
  }

  await browser.tabs.sendMessage(tabId, { type: MESSAGE.scanMedia }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 220));

  const frames = tabFrameMedia.get(tabId);
  if (!frames?.size) return { success: true, media: [], pageTitle: '' };
  const merged = new Map<string, MediaItem>();
  const orderedFrames = [...frames.entries()].sort(([left], [right]) => left - right);
  for (const [, snapshot] of orderedFrames) {
    if (Date.now() - snapshot.updatedAt > 10 * 60_000) continue;
    for (const item of snapshot.media) {
      const existing = merged.get(item.id);
      if (!existing || (!existing.poster && item.poster)) merged.set(item.id, item);
    }
  }

  const topFrame = frames.get(0);
  const pageTitle = topFrame?.pageTitle || orderedFrames[0]?.[1].pageTitle || '';
  return { success: true, media: [...merged.values()], pageTitle };
}

async function handleStartDownload(message: StartDownloadMessage) {
  if (!isMediaItem(message.item)) return { success: false, error: 'Invalid media request.' };

  const item = message.item;
  const jobId = createJobId();
  if (item.kind === 'blob') {
    if (!Number.isInteger(message.tabId)) {
      return { success: false, error: 'The active Whop tab is unavailable.' };
    }
    await startBlobDownload(item, Number(message.tabId), jobId);
    return { success: true, jobId };
  }

  assertDownloadableUrl(item.url);
  if (item.kind === 'dash') {
    return { success: false, error: 'DASH downloads are not supported in this first build.' };
  }

  if (item.kind === 'direct') await startDirectDownload(item, jobId);
  else await startHlsDownload(item, jobId);
  return { success: true, jobId };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return;
    const typed = message as { type?: string };

    if (typed.type === MESSAGE.reportFrameMedia) {
      if (sender.tab?.id === undefined) {
        sendResponse({ success: false });
        return;
      }
      sendResponse(
        recordFrameMedia(message as ReportFrameMediaMessage, sender.tab.id, sender.frameId ?? 0),
      );
      return;
    }
    if (typed.type === MESSAGE.getTabMedia) {
      void getTabMedia(message as GetTabMediaMessage)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            success: false,
            media: [],
            pageTitle: '',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }
    if (typed.type === MESSAGE.downloadComplete || typed.type === MESSAGE.downloadFailed) {
      scheduleOffscreenClose();
      return;
    }
    if (typed.type !== MESSAGE.startDownload) return;

    void handleStartDownload(message as StartDownloadMessage)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  });

  browser.downloads.onChanged.addListener((delta) => {
    const job = directJobs.get(delta.id);
    if (!job) return;

    if (delta.state?.current === 'complete') {
      const message: DownloadCompleteMessage = {
        type: MESSAGE.downloadComplete,
        jobId: job.jobId,
        mediaId: job.item.id,
        filename: job.filename,
      };
      directJobs.delete(delta.id);
      void browser.runtime.sendMessage(message).catch(() => undefined);
    }

    if (delta.state?.current === 'interrupted') {
      const message: DownloadFailedMessage = {
        type: MESSAGE.downloadFailed,
        jobId: job.jobId,
        mediaId: job.item.id,
        error: delta.error?.current || 'Chrome interrupted the download.',
      };
      directJobs.delete(delta.id);
      void browser.runtime.sendMessage(message).catch(() => undefined);
    }
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' || changeInfo.url) tabFrameMedia.delete(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => tabFrameMedia.delete(tabId));
});
