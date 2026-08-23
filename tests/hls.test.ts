import { describe, expect, it } from 'vitest';
import {
  isHlsMasterPlaylist,
  parseHlsMediaPlaylist,
  parseHlsVariants,
  selectBestHlsVariant,
} from '../lib/hls';

describe('HLS playlist parsing', () => {
  it('resolves variants and selects the highest bandwidth', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080
https://cdn.example.com/high.m3u8
`;

    const variants = parseHlsVariants(playlist, 'https://stream.example.com/master.m3u8');

    expect(isHlsMasterPlaylist(playlist)).toBe(true);
    expect(variants).toHaveLength(2);
    expect(variants[0]?.url).toBe('https://stream.example.com/low/index.m3u8');
    expect(selectBestHlsVariant(variants)).toMatchObject({
      bandwidth: 4_200_000,
      resolution: '1920x1080',
    });
  });

  it('parses fMP4 initialization and media segments', () => {
    const playlist = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
segment-1.m4s
#EXTINF:4.0,
segment-2.m4s
`;

    expect(parseHlsMediaPlaylist(playlist, 'https://cdn.example.com/path/video.m3u8')).toEqual({
      initSegment: 'https://cdn.example.com/path/init.mp4',
      segments: [
        'https://cdn.example.com/path/segment-1.m4s',
        'https://cdn.example.com/path/segment-2.m4s',
      ],
      encrypted: false,
      usesByteRanges: false,
    });
  });

  it('marks encrypted and byte-range playlists as unsupported', () => {
    const playlist = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-BYTERANGE:1024@0
segment.ts
`;

    const parsed = parseHlsMediaPlaylist(playlist, 'https://cdn.example.com/video.m3u8');
    expect(parsed.encrypted).toBe(true);
    expect(parsed.usesByteRanges).toBe(true);
  });
});
