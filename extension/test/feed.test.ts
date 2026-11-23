import { IDBFactory } from 'fake-indexeddb';
import { afterEach, vi } from 'vitest';
import { resetDbForTests } from '../src/core/db';
import { refreshProductFeed, saveProductFeed } from '../src/core/feed';
import { addBackup, createProduct, createQuestion, loadSnapshot, recordAnswerCopy, updateAnswer } from '../src/core/library';
import { answerImportPrompt, buildBackup, parseBackup } from '../src/core/portable';

const url = 'https://example.com/feed.json';
const entry = (question: string, text: string, label?: string) => ({ question, answers: [{ text, label }] });
const feed = (answers: ReturnType<typeof entry>[], etag = '"first"') =>
  Response.json({ product: 'Field Notes', answers }, { headers: { ETag: etag } });

function mockFetch() {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  return request;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('tests and saves an unchanged feed URL with one request and reports validated counts', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes');
  request.mockResolvedValueOnce(feed([entry('Offline?', 'Yes.')]));
  await expect(saveProductFeed(product, url)).resolves.toEqual({ questions: 1, answers: 1 });

  const [saved] = (await loadSnapshot()).products;
  request.mockClear();
  request.mockResolvedValueOnce(feed([{
    question: 'Offline?',
    answers: [{ text: 'Yes.', label: 'Short' }, { text: 'Saved notes work offline.', label: 'Detailed' }],
  }]));
  await expect(saveProductFeed(saved, url)).resolves.toEqual({ questions: 1, answers: 2 });
  expect(request).toHaveBeenCalledTimes(1);
  expect((await loadSnapshot()).answers).toHaveLength(2);
});

it('retains copy usage for matching feed question and text through a refresh', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes');
  request.mockResolvedValueOnce(feed([entry('Offline?', 'Yes.', 'Short'), entry('Where?', 'Old text.')]));
  await saveProductFeed(product, url);
  const before = (await loadSnapshot()).answers;
  const unchanged = before.find((answer) => answer.text === 'Yes.')!;
  await recordAnswerCopy(unchanged.id);
  await recordAnswerCopy(before.find((answer) => answer.text === 'Old text.')!.id);
  const used = (await loadSnapshot()).answers.find((answer) => answer.id === unchanged.id)!;

  request.mockResolvedValueOnce(feed([entry('OFFLINE?', 'Yes.', 'New label'), entry('Where?', 'New text.')]));
  await refreshProductFeed(product.id, true);
  const after = (await loadSnapshot()).answers;
  expect(after.find((answer) => answer.text === 'Yes.')).toEqual({ ...used, label: 'New label' });
  expect(after.find((answer) => answer.text === 'New text.')).not.toHaveProperty('copyCount');
});

it('atomically replaces feed entries and keeps questions saved locally before and after setup', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes', 'Can I export?');
  const other = await createProduct('Other', 'Unrelated?');
  await createQuestion(product.id, 'Local answered?', { text: 'Old local answer.' });
  const original = (await loadSnapshot()).questions.find((q) => q.question === 'Can I export?');
  request.mockResolvedValueOnce(feed([entry('Offline?', 'Old'), entry('Obsolete?', 'Remove')]));
  await saveProductFeed(product, url);
  await createQuestion(product.id, 'Still open?');
  const first = await loadSnapshot();
  expect(first.questions.map((q) => q.question)).not.toContain('Local answered?');
  expect(first.questions.some((q) => q.product_id === other.id)).toBe(true);

  request.mockResolvedValueOnce(feed([
    entry('OFFLINE?', 'Updated', 'New label'), entry('New?', 'Added'), entry('  CAN I EXPORT?  ', 'Yes.'),
  ], '"second"'));
  await refreshProductFeed(product.id, true);
  const next = await loadSnapshot();
  expect(next.questions.filter((q) => q.product_id === product.id).map((q) => q.question).sort())
    .toEqual(['Can I export?', 'New?', 'OFFLINE?', 'Still open?']);
  expect(next.answers.map((a) => a.text).sort()).toEqual(['Added', 'Updated', 'Yes.']);
  expect(next.answers.find((a) => a.text === 'Updated')?.label).toBe('New label');
  expect(next.answers.find((a) => a.text === 'Yes.')?.question_id).toBe(original?.id);
  await expect(updateAnswer(next.answers[0].id, { text: 'Local edit' })).rejects.toThrow('Edit the source file');

  request.mockResolvedValueOnce(feed([], '"empty"'));
  await refreshProductFeed(product.id, true);
  const cleared = await loadSnapshot();
  expect(cleared.questions.filter((q) => q.product_id === product.id).map((q) => q.question).sort())
    .toEqual(['Can I export?', 'Still open?']);
  expect(cleared.answers).toEqual([]);
});

it('keeps the previous mirror on invalid feeds, including a valid item before an invalid one', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes');
  request.mockResolvedValueOnce(feed([entry('Original?', 'Previous')]));
  await saveProductFeed(product, url);
  const before = await loadSnapshot();

  request.mockResolvedValueOnce(Response.json({ product: product.name, answers: [
    entry('New?', 'New answer'), { question: 'Broken?', answers: [] },
  ] }));
  await refreshProductFeed(product.id, true);
  const after = await loadSnapshot();
  expect(after.questions).toEqual(before.questions);
  expect(after.answers).toEqual(before.answers);
  expect(after.products[0].feed).toMatchObject({ error: 'Question 2 must include at least one answer.', etag: '"first"' });

  request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(saveProductFeed(after.products[0], 'https://example.com/other.json'))
    .rejects.toThrow("This host doesn't allow SnipCue to read it. Use a raw GitHub or Gist link.");
  expect(await loadSnapshot()).toEqual(after);
});

it('throttles automatic refreshes and sends If-None-Match on a manual or expired refresh', async () => {
  const request = mockFetch();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const product = await createProduct('Field Notes');
  request.mockResolvedValueOnce(feed([entry('Original?', 'Previous')]));
  await saveProductFeed(product, url);
  const before = await loadSnapshot();

  await refreshProductFeed(product.id);
  expect(request).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(11_000);
  request.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await refreshProductFeed(product.id, true);
  expect(request).toHaveBeenLastCalledWith(url, expect.objectContaining({
    cache: 'no-cache', credentials: 'omit', headers: { 'If-None-Match': '"first"' },
  }));
  const after = await loadSnapshot();
  expect(after.products[0].feed).toMatchObject({ synced_at: 11_000, etag: '"first"' });
  expect(after.answers).toEqual(before.answers);
  expect(after.questions).toEqual(before.questions);

  clock.mockReturnValue(311_000);
  request.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await refreshProductFeed(product.id);
  expect(request).toHaveBeenCalledTimes(3);
});

it('rejects non-HTTPS URLs and oversized bodies before changing the product', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes', 'Can I export?');
  await expect(saveProductFeed(product, 'http://example.com/feed.json')).rejects.toThrow('HTTPS');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await expect(saveProductFeed(product, url)).rejects.toThrow('larger than 2 MB');
  expect((await loadSnapshot()).products).toEqual([product]);
});

it('includes the feed URL and saved questions in the backup and the feed prompt', async () => {
  const request = mockFetch();
  const product = await createProduct('Field Notes', 'Can I export?');
  request.mockResolvedValueOnce(feed([entry('Offline?', 'Yes.')]));
  await saveProductFeed(product, url);
  const snapshot = await loadSnapshot();
  const prompt = answerImportPrompt(snapshot.products[0], snapshot);
  expect(prompt).toContain('Update this JSON file: add answers for these open questions, keep existing entries.');
  expect(prompt).toContain(url);
  expect(prompt).toContain('Answer these questions\n- "Can I export?"');
  const backup = buildBackup(snapshot);
  expect(backup.products[0]).toEqual({ id: product.id, name: product.name, feed_url: url });

  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  await addBackup(parseBackup(JSON.stringify(backup)));
  const restored = await loadSnapshot();
  expect(restored.products[0].feed_url).toBe(url);
  expect(restored.questions.find((q) => q.question === 'Can I export?')?.local_open).toBe(true);
  expect(restored.answers[0].text).toBe('Yes.');
});
