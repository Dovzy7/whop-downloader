import type { MediaSource } from './messages';

export const DETECTION_CHANNEL = 'whop-media-saver:detection:v1';

export interface DetectionCandidate {
  channel: typeof DETECTION_CHANNEL;
  type: 'candidate';
  url: string;
  title: string;
  source: MediaSource;
  poster?: string;
  duration?: number;
}

export interface DetectionSnapshotRequest {
  channel: typeof DETECTION_CHANNEL;
  type: 'request-snapshot';
}
