import { describe, expect, it } from 'vitest';
import { isMediaItem } from '../lib/messages';

describe('media message validation', () => {
  it('accepts frame-aware Blob detections', () => {
    expect(
      isMediaItem({
        id: 'media_blob',
        title: 'Recorded lesson',
        url: 'blob:https://whop.com/123',
        kind: 'blob',
        source: 'blob',
        frameId: 3,
      }),
    ).toBe(true);
  });

  it('rejects unknown media kinds', () => {
    expect(
      isMediaItem({
        id: 'media_unknown',
        title: 'Unknown',
        url: 'https://example.com/file.bin',
        kind: 'binary',
      }),
    ).toBe(false);
  });
});
