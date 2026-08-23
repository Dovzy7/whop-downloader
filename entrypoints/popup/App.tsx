import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  MESSAGE,
  type DownloadEventMessage,
  type DownloadStartedResponse,
  type MediaItem,
  type ScanMediaResponse,
} from '../../lib/messages';

interface JobState {
  jobId?: string;
  percentage: number;
  status: string;
  phase: 'idle' | 'working' | 'complete' | 'failed';
}

const EMPTY_JOB: JobState = {
  percentage: 0,
  status: '',
  phase: 'idle',
};

function formatDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function formatSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'media';
  }
}

function kindLabel(item: MediaItem): string {
  if (item.kind === 'hls') return 'HLS';
  if (item.kind === 'dash') return 'DASH';
  try {
    return new URL(item.url).pathname.split('.').pop()?.toUpperCase() || 'VIDEO';
  } catch {
    return 'VIDEO';
  }
}

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState('Current Whop page');
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !/^https:\/\/([^.]+\.)*whop\.com\//i.test(tab.url)) {
        throw new Error('Open a Whop page, then run the scan again.');
      }

      const response = (await browser.tabs.sendMessage(tab.id, {
        type: MESSAGE.scanMedia,
      })) as ScanMediaResponse;
      if (!response?.success) throw new Error(response?.error || 'The page scan failed.');
      setMedia(response.media);
      setPageTitle(response.pageTitle || tab.title || 'Current Whop page');
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      setMedia([]);
      setError(
        /receiving end does not exist|could not establish connection/i.test(message)
          ? 'Reload the Whop tab once so the extension can connect, then scan again.'
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const event = message as DownloadEventMessage;
      if (
        event.type !== MESSAGE.downloadProgress &&
        event.type !== MESSAGE.downloadComplete &&
        event.type !== MESSAGE.downloadFailed
      ) {
        return;
      }

      setJobs((current) => {
        const previous = current[event.mediaId] ?? EMPTY_JOB;
        if (event.type === MESSAGE.downloadProgress) {
          return {
            ...current,
            [event.mediaId]: {
              jobId: event.jobId,
              percentage: event.percentage,
              status: event.status,
              phase: 'working',
            },
          };
        }
        if (event.type === MESSAGE.downloadComplete) {
          return {
            ...current,
            [event.mediaId]: {
              jobId: event.jobId,
              percentage: 100,
              status: `Saved as ${event.filename}`,
              phase: 'complete',
            },
          };
        }
        return {
          ...current,
          [event.mediaId]: {
            ...previous,
            jobId: event.jobId,
            status: event.error,
            phase: 'failed',
          },
        };
      });
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const startDownload = async (item: MediaItem) => {
    setJobs((current) => ({
      ...current,
      [item.id]: { percentage: 1, status: 'Starting download', phase: 'working' },
    }));

    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE.startDownload,
        item,
      })) as DownloadStartedResponse;
      if (!response?.success) throw new Error(response?.error || 'Download could not be started.');
      setJobs((current) => ({
        ...current,
        [item.id]: {
          ...(current[item.id] ?? EMPTY_JOB),
          jobId: response.jobId,
          phase: 'working',
        },
      }));
    } catch (downloadError) {
      setJobs((current) => ({
        ...current,
        [item.id]: {
          percentage: 0,
          status: downloadError instanceof Error ? downloadError.message : String(downloadError),
          phase: 'failed',
        },
      }));
    }
  };

  const countLabel = useMemo(
    () => `${media.length} ${media.length === 1 ? 'video' : 'videos'}`,
    [media.length],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <span>↓</span>
        </div>
        <div className="brand-copy">
          <strong>Whop Media Saver</strong>
          <span>Authorized downloads</span>
        </div>
        <button className="icon-button" type="button" onClick={() => void scan()} disabled={loading}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
          </svg>
          <span className="sr-only">Scan again</span>
        </button>
      </header>

      <section className="page-summary">
        <div>
          <span className="eyebrow">ACTIVE PAGE</span>
          <h1 title={pageTitle}>{pageTitle}</h1>
        </div>
        <span className="count-pill">{loading ? 'Scanning' : countLabel}</span>
      </section>

      <section className="results" aria-live="polite">
        {loading && (
          <div className="empty-state">
            <div className="scanner" aria-hidden="true" />
            <h2>Looking for media</h2>
            <p>Checking videos and Mux players on this page.</p>
          </div>
        )}

        {!loading && error && (
          <div className="empty-state error-state">
            <div className="state-icon">!</div>
            <h2>Couldn’t scan this page</h2>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => void scan()}>
              Scan again
            </button>
          </div>
        )}

        {!loading && !error && media.length === 0 && (
          <div className="empty-state">
            <div className="state-icon">0</div>
            <h2>No downloadable video yet</h2>
            <p>Play or scroll the video into view, then scan again.</p>
            <button className="secondary-button" type="button" onClick={() => void scan()}>
              Scan again
            </button>
          </div>
        )}

        {!loading &&
          media.map((item, index) => {
            const job = jobs[item.id] ?? EMPTY_JOB;
            const unsupported = item.kind === 'dash';
            const working = job.phase === 'working';
            return (
              <article className="media-card" key={item.id}>
                <div className="media-index">{String(index + 1).padStart(2, '0')}</div>
                <div className="media-details">
                  <div className="media-title-row">
                    <h2>{item.title}</h2>
                    <span className={`format-badge format-${item.kind}`}>{kindLabel(item)}</span>
                  </div>
                  <div className="media-meta">
                    <span>{formatSource(item.url)}</span>
                    {formatDuration(item.duration) && <span>{formatDuration(item.duration)}</span>}
                    <span>{item.source.replace('-', ' ')}</span>
                  </div>

                  {job.phase !== 'idle' && (
                    <div className={`job-status status-${job.phase}`}>
                      <div className="progress-track">
                        <div className="progress-value" style={{ width: `${job.percentage}%` }} />
                      </div>
                      <span>{job.status}</span>
                    </div>
                  )}
                </div>
                <button
                  className="download-button"
                  type="button"
                  disabled={working || unsupported}
                  title={unsupported ? 'DASH support is coming later' : 'Download video'}
                  onClick={() => void startDownload(item)}
                >
                  {working ? (
                    <span className="button-spinner" aria-hidden="true" />
                  ) : job.phase === 'complete' ? (
                    '✓'
                  ) : (
                    '↓'
                  )}
                  <span className="sr-only">Download {item.title}</span>
                </button>
              </article>
            );
          })}
      </section>

      <footer>
        Only save media you own or have permission to download. Encrypted streams are unsupported.
      </footer>
    </main>
  );
}
