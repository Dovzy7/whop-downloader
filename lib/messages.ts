export const MESSAGE = {
  scanMedia: 'SCAN_MEDIA',
  reportFrameMedia: 'REPORT_FRAME_MEDIA',
  getTabMedia: 'GET_TAB_MEDIA',
  startDownload: 'START_DOWNLOAD',
  downloadBlob: 'DOWNLOAD_BLOB',
  downloadProgress: 'DOWNLOAD_PROGRESS',
  downloadComplete: 'DOWNLOAD_COMPLETE',
  downloadFailed: 'DOWNLOAD_FAILED',
  processHls: 'PROCESS_HLS',
  cancelHls: 'CANCEL_HLS',
  pingOffscreen: 'PING_OFFSCREEN',
} as const;

export type MediaKind = 'direct' | 'hls' | 'dash' | 'blob';

export type MediaSource =
  | 'video'
  | 'source'
  | 'mux-player'
  | 'mux-video'
  | 'metadata'
  | 'network'
  | 'performance'
  | 'closed-shadow'
  | 'blob';

export interface MediaItem {
  id: string;
  title: string;
  url: string;
  kind: MediaKind;
  source: MediaSource;
  poster?: string;
  duration?: number;
  frameId?: number;
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

export interface ReportFrameMediaMessage {
  type: typeof MESSAGE.reportFrameMedia;
  media: MediaItem[];
  pageTitle: string;
  pageUrl: string;
}

export interface GetTabMediaMessage {
  type: typeof MESSAGE.getTabMedia;
  tabId: number;
}

export interface StartDownloadMessage {
  type: typeof MESSAGE.startDownload;
  item: MediaItem;
  tabId?: number;
}

export interface DownloadBlobMessage {
  type: typeof MESSAGE.downloadBlob;
  url: string;
  filename: string;
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
    ['direct', 'hls', 'dash', 'blob'].includes(item.kind ?? '')
  );
}
