import { beginFeedRefresh, commitFeed } from './library';
import { parseFeed } from './portable';
import type { DraftQuestion, Product } from './types';
import { readFeedUrl } from './validate';

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

async function readFeedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_FEED_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new Error('The feed is larger than 2 MB.');
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function fetchFeed(product: Product, url: string, etag?: string): Promise<{ drafts?: DraftQuestion[]; etag?: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const request: RequestInit = { signal, cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' };
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...request, headers: etag ? { 'If-None-Match': etag } : undefined });
    } catch (error) {
      // Some CORS hosts expose ETag but reject the conditional header's preflight.
      if (!(error instanceof TypeError) || !etag || signal.aborted) throw error;
      response = await fetch(url, request);
    }
    if (response.status === 304 && etag) return { etag: response.headers.get('ETag') ?? etag };
    if (!response.ok) throw new Error(`Feed request failed (HTTP ${response.status}).`);
    const drafts = parseFeed(await readFeedBody(response), product);
    return { drafts, etag: response.headers.get('ETag') ?? undefined };
  } catch (error) {
    if (signal.aborted) throw new Error('The feed request timed out.');
    if (error instanceof TypeError) throw new Error("This host doesn't allow SnipCue to read it. Use a raw GitHub or Gist link.");
    throw error;
  }
}

export async function saveProductFeed(product: Product, input: string): Promise<{ questions: number; answers: number } | null> {
  const url = input.trim() ? readFeedUrl(input) : undefined;
  if (!url && !product.feed_url) return null;
  const checked_at = Date.now();
  const result = url ? await fetchFeed(product, url) : undefined;
  const feed = result && { checked_at, synced_at: Date.now(), etag: result.etag };
  if (!await commitFeed(product, url, feed, result?.drafts)) {
    throw new Error('This product changed. Open its settings and try again.');
  }
  const drafts = result?.drafts;
  return drafts ? { questions: drafts.length, answers: drafts.reduce((total, q) => total + q.answers.length, 0) } : null;
}

export async function refreshProductFeed(productId: string, force = false): Promise<void> {
  const product = await beginFeedRefresh(productId, force);
  if (!product?.feed_url || !product.feed) return;
  let result;
  try {
    result = await fetchFeed(product, product.feed_url, product.feed.etag);
  } catch (error) {
    await commitFeed(product, product.feed_url, { ...product.feed, error: (error as Error).message });
    return;
  }
  await commitFeed(product, product.feed_url, {
    checked_at: product.feed.checked_at,
    synced_at: Date.now(),
    etag: result.etag,
  }, result.drafts);
}
