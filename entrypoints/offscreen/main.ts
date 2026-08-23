import {
  Conversion,
  HLS_FORMATS,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  UrlSource,
} from 'mediabunny';
import { browser } from 'wxt/browser';
import { filenameForMedia } from '../../lib/filename';
import {
  isHlsMasterPlaylist,
  parseHlsMediaPlaylist,
  parseHlsVariants,
  selectBestHlsVariant,
} from '../../lib/hls';
import {
  MESSAGE,
  type DownloadCompleteMessage,
  type DownloadFailedMessage,
  type DownloadProgressMessage,
  type ProcessHlsMessage,
} from '../../lib/messages';

interface ActiveHlsJob {
  abort: () => void;
}

const activeJobs = new Map<string, ActiveHlsJob>();
const MAX_OUTPUT_BYTES = 1_500_000_000;

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { credentials: 'include', signal });
  if (!response.ok) throw new Error(`Media server returned HTTP ${response.status}.`);
  return response.text();
}

async function emitProgress(
  message: ProcessHlsMessage,
  percentage: number,
  status: string,
): Promise<void> {
  const progress: DownloadProgressMessage = {
    type: MESSAGE.downloadProgress,
    jobId: message.jobId,
    mediaId: message.item.id,
    percentage: Math.max(0, Math.min(99, Math.round(percentage))),
    status,
  };
  await browser.runtime.sendMessage(progress).catch(() => undefined);
}

function startBlobDownload(blob: Blob, filename: string, cleanup: () => Promise<void>): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    void cleanup();
  }, 60_000);
}

async function assertPlaylistIsUnencrypted(url: string, signal: AbortSignal): Promise<void> {
  let playlistUrl = url;
  let playlistText = await fetchText(playlistUrl, signal);

  if (isHlsMasterPlaylist(playlistText)) {
    const variant = selectBestHlsVariant(parseHlsVariants(playlistText, playlistUrl));
    if (!variant) throw new Error('No playable HLS quality was found.');
    playlistUrl = variant.url;
    playlistText = await fetchText(playlistUrl, signal);
  }

  if (parseHlsMediaPlaylist(playlistText, playlistUrl).encrypted) {
    throw new Error('Encrypted or DRM-protected HLS is intentionally unsupported.');
  }
}

async function createOpfsTarget(jobId: string) {
  const root = await navigator.storage.getDirectory();
  const tempName = `whop-media-${jobId}.mp4`;
  const fileHandle = await root.getFileHandle(tempName, { create: true });
  const fileStream = await fileHandle.createWritable();
  let outputBytes = 0;

  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      outputBytes = Math.max(outputBytes, chunk.position + chunk.data.byteLength);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        throw new Error('This video exceeds the current 1.5 GB download limit.');
      }
      await fileStream.write({ type: 'write', position: chunk.position, data: chunk.data });
    },
    async close() {
      await fileStream.close();
    },
    async abort(reason) {
      await fileStream.abort(reason);
    },
  });

  return {
    target: new StreamTarget(writable, { chunked: true, chunkSize: 16 * 1024 * 1024 }),
    async getFile() {
      return fileHandle.getFile();
    },
    async cleanup() {
      await root.removeEntry(tempName).catch(() => undefined);
    },
  };
}

async function processHls(message: ProcessHlsMessage): Promise<void> {
  const controller = new AbortController();
  let input: Input | null = null;
  let conversion: Conversion | null = null;
  let cleanupTempFile: (() => Promise<void>) | null = null;

  activeJobs.set(message.jobId, {
    abort() {
      controller.abort();
      input?.dispose();
      if (conversion) void conversion.cancel();
    },
  });

  try {
    await emitProgress(message, 2, 'Checking HLS playlist');
    await assertPlaylistIsUnencrypted(message.item.url, controller.signal);
    if (controller.signal.aborted) throw new Error('Download cancelled.');

    await emitProgress(message, 5, 'Preparing highest-quality video and audio');
    input = new Input({
      source: new UrlSource(message.item.url, {
        requestInit: { credentials: 'include' },
        parallelism: 4,
      }),
      formats: HLS_FORMATS,
    });

    const opfs = await createOpfsTarget(message.jobId);
    cleanupTempFile = opfs.cleanup;
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
      target: opfs.target,
    });

    conversion = await Conversion.init({ input, output, tracks: 'primary' });
    if (!conversion.isValid) {
      throw new Error('The detected HLS tracks cannot be converted to an MP4 in this browser.');
    }

    conversion.onProgress = (progress) => {
      void emitProgress(message, 8 + progress * 86, 'Downloading and assembling MP4');
    };
    await conversion.execute();
    if (controller.signal.aborted) throw new Error('Download cancelled.');

    await emitProgress(message, 96, 'Preparing browser download');
    const file = await opfs.getFile();
    if (!file.size) throw new Error('The converted MP4 was empty.');
    const filename = filenameForMedia(message.item.title, 'hls', message.item.url);
    startBlobDownload(file, filename, opfs.cleanup);
    cleanupTempFile = null;

    const complete: DownloadCompleteMessage = {
      type: MESSAGE.downloadComplete,
      jobId: message.jobId,
      mediaId: message.item.id,
      filename,
    };
    await browser.runtime.sendMessage(complete).catch(() => undefined);
  } catch (error) {
    const failed: DownloadFailedMessage = {
      type: MESSAGE.downloadFailed,
      jobId: message.jobId,
      mediaId: message.item.id,
      error:
        controller.signal.aborted
          ? 'Download cancelled.'
          : error instanceof Error
            ? error.message
            : String(error),
    };
    await browser.runtime.sendMessage(failed).catch(() => undefined);
  } finally {
    input?.dispose();
    if (cleanupTempFile) await cleanupTempFile();
    activeJobs.delete(message.jobId);
  }
}

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return;
  const typed = message as { type?: string; jobId?: string };

  if (typed.type === MESSAGE.pingOffscreen) return Promise.resolve({ ready: true });
  if (typed.type === MESSAGE.processHls) {
    void processHls(message as ProcessHlsMessage);
    return Promise.resolve({ accepted: true });
  }
  if (typed.type === MESSAGE.cancelHls && typed.jobId) {
    activeJobs.get(typed.jobId)?.abort();
    return Promise.resolve({ cancelled: true });
  }
});
