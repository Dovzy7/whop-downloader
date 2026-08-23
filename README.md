# Whop Media Saver

A clean-room Chrome Manifest V3 extension for saving media that the current user is authorized to download from Whop pages.

## Download

[Download the packaged Chrome extension](releases/whop-media-saver-0.1.0-chrome.zip), then unzip it and load the extracted folder from `chrome://extensions` with Developer mode enabled.

## Current MVP

- Scans every eligible frame for native `<video>`, `<mux-player>`, generic playback-ID elements, and metadata.
- Observes open and closed shadow roots from document start.
- Detects manifest and file URLs from fetch, XHR, and browser performance resource entries.
- Tracks genuine video/audio Blob object URLs without treating MediaSource playback blobs as files.
- Re-scans dynamic Whop SPA content through throttled DOM observers.
- Downloads direct MP4, WebM, MOV, M4V, MPEG, and MPG files through Chrome.
- Downloads unencrypted HLS playlists in an offscreen extension document.
- Uses Mediabunny to select primary high-quality video/audio tracks and assemble an MP4.
- Stages HLS output in the browser's private OPFS storage instead of holding the full MP4 in memory.
- Shows download progress and errors in the popup.
- Rejects encrypted playlists, DASH, MediaSource blobs, and insecure URLs.

The MVP caps generated MP4 output at roughly 1.5 GB. DASH, cancellation UI, and persistent download history are later milestones.

## Development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

WXT opens a Chromium development profile with the unpacked extension installed. Open a Whop page, reload it once after the extension is installed, and select the toolbar icon.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The production extension is written to `.output/chrome-mv3`.

To load it manually:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `.output/chrome-mv3`.

## Safety and product boundary

Only download content you own or have explicit permission to save. This extension intentionally does not bypass encryption, DRM, authentication, paywalls, or access controls. Before publishing it, review Whop's current platform terms and obtain any required approval.
# whop-downloader
