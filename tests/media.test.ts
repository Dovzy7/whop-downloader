import { describe, expect, it } from 'vitest';
import { filenameForMedia, sanitizeFilename } from '../lib/filename';
import { buildMuxHlsUrl, classifyMediaUrl, createMediaItem, normalizeMediaUrl } from '../lib/media';

describe('media helpers', () => {
  it('classifies supported media URLs', () => {
    expect(classifyMediaUrl('https://cdn.example.com/video.mp4?token=abc')).toBe('direct');
    expect(classifyMediaUrl('https://stream.example.com/master.m3u8')).toBe('hls');
    expect(classifyMediaUrl('https://stream.example.com/manifest.mpd')).toBe('dash');
    expect(classifyMediaUrl('https://stream.example.com/page')).toBeNull();
  });

  it('rejects blob, data, and insecure URLs', () => {
    expect(normalizeMediaUrl('blob:https://whop.com/123')).toBeNull();
    expect(normalizeMediaUrl('data:video/mp4;base64,abc')).toBeNull();
    expect(normalizeMediaUrl('http://example.com/video.mp4')).toBeNull();
  });

  it('builds a signed Mux HLS URL without dropping the query', () => {
    expect(buildMuxHlsUrl('playback_123?token=signed-value')).toBe(
      'https://stream.mux.com/playback_123.m3u8?token=signed-value',
    );
  });

  it('creates stable media items and safe filenames', () => {
    const first = createMediaItem('https://cdn.example.com/video.mp4', {
      title: 'Lesson 1',
      source: 'video',
    });
    const second = createMediaItem('https://cdn.example.com/video.mp4', {
      title: 'Different title',
      source: 'source',
    });

    expect(first?.id).toBe(second?.id);
    expect(sanitizeFilename('A / bad:* title. ')).toBe('A bad title');
    expect(filenameForMedia('Lesson 1', 'direct', 'https://cdn.example.com/movie.webm')).toBe(
      'Lesson 1.webm',
    );
  });
});
