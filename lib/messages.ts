export const MESSAGE = {
  scanMedia: 'SCAN_MEDIA',
  startDownload: 'START_DOWNLOAD',
  downloadProgress: 'DOWNLOAD_PROGRESS',
  downloadComplete: 'DOWNLOAD_COMPLETE',
  downloadFailed: 'DOWNLOAD_FAILED',
  processHls: 'PROCESS_HLS',
  cancelHls: 'CANCEL_HLS',
  pingOffscreen: 'PING_OFFSCREEN',
} as const;

export type MediaKind = 'direct' | 'hls' | 'dash';

export interface MediaItem {
  id: string;
  title: string;
  url: string;
  kind: MediaKind;
  source: 'video' | 'source' | 'mux-player' | 'mux-video' | 'metadata';
  poster?: string;
  duration?: number;
}

export interface ScanMediaMessage {
  type: typeof MESSAGE.scanMedia;
}

export interface ScanMediaResponse {
  success: boolean;
  media: MediaItem[];
  pageTitle: string;
  error?: string;
}

export interface StartDownloadMessage {
  type: typeof MESSAGE.startDownload;
  item: MediaItem;
}

export interface DownloadStartedResponse {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface ProcessHlsMessage {
  type: typeof MESSAGE.processHls;
  jobId: string;
  item: MediaItem;
}

export interface CancelHlsMessage {
  type: typeof MESSAGE.cancelHls;
  jobId: string;
}

export interface DownloadProgressMessage {
  type: typeof MESSAGE.downloadProgress;
  jobId: string;
  mediaId: string;
  percentage: number;
  status: string;
}

export interface DownloadCompleteMessage {
  type: typeof MESSAGE.downloadComplete;
  jobId: string;
  mediaId: string;
  filename: string;
}

export interface DownloadFailedMessage {
  type: typeof MESSAGE.downloadFailed;
  jobId: string;
  mediaId: string;
  error: string;
}

export type DownloadEventMessage =
  | DownloadProgressMessage
  | DownloadCompleteMessage
  | DownloadFailedMessage;

export function isMediaItem(value: unknown): value is MediaItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MediaItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    ['direct', 'hls', 'dash'].includes(item.kind ?? '')
  );
}
