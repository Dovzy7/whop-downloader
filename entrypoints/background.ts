import { browser } from 'wxt/browser';
import { filenameForMedia } from '../lib/filename';
import {
  isMediaItem,
  MESSAGE,
  type DownloadCompleteMessage,
  type DownloadFailedMessage,
  type DownloadProgressMessage,
  type MediaItem,
  type ProcessHlsMessage,
  type StartDownloadMessage,
} from '../lib/messages';

interface DirectDownloadJob {
  jobId: string;
  item: MediaItem;
  filename: string;
}

const directJobs = new Map<number, DirectDownloadJob>();
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

async function handleStartDownload(message: StartDownloadMessage) {
  if (!isMediaItem(message.item)) return { success: false, error: 'Invalid media request.' };

  const item = message.item;
  const jobId = createJobId();
  assertDownloadableUrl(item.url);

  if (item.kind === 'dash') {
    return { success: false, error: 'DASH downloads are not supported in this first build.' };
  }

  if (item.kind === 'direct') await startDirectDownload(item, jobId);
  else await startHlsDownload(item, jobId);
  return { success: true, jobId };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return;
    const typed = message as { type?: string };
    if (typed.type === MESSAGE.downloadComplete || typed.type === MESSAGE.downloadFailed) {
      scheduleOffscreenClose();
      return;
    }
    if (typed.type !== MESSAGE.startDownload) return;

    return handleStartDownload(message as StartDownloadMessage).catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
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
});
