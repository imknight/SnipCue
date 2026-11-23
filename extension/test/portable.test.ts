import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from '../src/core/db';
import { addBackup, recordsToAdd, createAnswer, createProduct, createQuestion, loadSnapshot } from '../src/core/library';
import { answerImportPrompt, BACKUP_VERSION, buildBackup, parseBackup, parsePastedAnswers } from '../src/core/portable';

const product = { id: 'test', name: 'Field Notes' };
const payload = { product: product.name, answers: [{ question: 'Does it work offline?', answers: [{ label: '中文', text: '可以离线使用。\n\n🙂' }] }] };
const json = JSON.stringify(payload);
const fenced = ['```json', json, '```'].join('\n');

it('extracts raw and fenced JSON from chat replies', () => {
  for (const reply of [json, `Here you go:\n${fenced}\nReady to use.`, `Here you go:\n${json}\nReady to use.`]) {
    expect(parsePastedAnswers(reply, product)).toEqual(payload.answers);
  }
});

it('reports invalid replies, multiple blocks, missing answers, and the wrong product', () => {
  expect(() => parsePastedAnswers('{ invalid', product)).toThrow('valid JSON object');
  expect(() => parsePastedAnswers(`${fenced}\n${fenced}`, product)).toThrow('only one JSON block');
  expect(() => parsePastedAnswers(JSON.stringify({ ...payload, product: 'Ink Pad' }), product)).toThrow('Field Notes');
  expect(() => parsePastedAnswers(JSON.stringify({ ...payload, answers: [{ question: 'Why?', answers: [] }] }), product)).toThrow('at least one answer');
});

it('asks the AI to answer this product’s open questions before listing answered questions', async () => {
  const product = await createProduct('Field Notes', 'Can I export notes?');
  const other = await createProduct('Other', 'Other product question?');
  await createQuestion(product.id, 'Does it work offline?', { text: 'Yes.' });
  await createQuestion(other.id, 'Other answered question?', { text: 'Yes.' });
  const snapshot = await loadSnapshot();
  const prompt = answerImportPrompt(product, snapshot);
  expect(prompt).toContain('Answer these questions\n- "Can I export notes?"');
  expect(prompt).toContain('Already answered (don\'t repeat)\n- "Does it work offline?"');
  expect(prompt.indexOf('Answer these questions')).toBeLessThan(prompt.indexOf('Already answered'));
  expect(prompt).not.toContain('Other product question?');
  expect(prompt).not.toContain('Other answered question?');
  expect(prompt).toContain('Reply with only one JSON object');
  expect(JSON.parse(prompt.slice(prompt.indexOf('{\n')))).toMatchObject({ product: 'Field Notes', answers: [{ answers: [{ text: 'Plain-text reply' }] }] });
  expect(answerImportPrompt(product, { ...snapshot, questions: snapshot.questions.filter((q) => q.question !== 'Can I export notes?') }))
    .toContain('Suggest common customer questions and answer them.');
});

it('round-trips products, questions, labels, and text through a backup, then skips repeat imports', async () => {
  const product = await createProduct('Field Notes');
  await createProduct('Empty product');
  await createQuestion(product.id, 'Offline?', { label: '中文', text: '可以离线使用。\n\n🙂' });
  const [question] = (await loadSnapshot()).questions;
  await createAnswer(question.id, { text: 'Yes.' });
  const before = buildBackup(await loadSnapshot());
  expect(before.schema_version).toBe(BACKUP_VERSION);
  const drafts = parseBackup(JSON.stringify(before));

  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  const additions = recordsToAdd(await loadSnapshot(), drafts);
  expect(additions.products).toHaveLength(2);
  expect(additions.questions).toHaveLength(1);
  expect(await addBackup(drafts)).toEqual({ products: 2, questions: 1, answers: 2 });
  const after = await loadSnapshot();
  expect(after.products.map((p) => p.name).sort()).toEqual(['Empty product', 'Field Notes']);
  expect(after.questions[0]).toMatchObject({ question: 'Offline?', created_at: question.created_at, updated_at: question.updated_at });
  expect(after.answers.map(({ label, text }) => ({ label, text })).sort((a, b) => a.text.localeCompare(b.text)))
    .toEqual([{ label: undefined, text: 'Yes.' }, { label: '中文', text: '可以离线使用。\n\n🙂' }].sort((a, b) => a.text.localeCompare(b.text)));
  expect(await addBackup(drafts)).toEqual({ products: 0, questions: 0, answers: 0 });
});

it('rejects an old backup version and orphan answers', () => {
  const backup = buildBackup({ products: [], questions: [], answers: [] });
  expect(() => parseBackup(JSON.stringify({ ...backup, schema_version: 1 }))).toThrow(`schema version ${BACKUP_VERSION}`);
  expect(() => parseBackup(JSON.stringify({
    ...backup,
    answers: [{ id: crypto.randomUUID(), question_id: crypto.randomUUID(), text: 'Orphan' }],
  }))).toThrow('question missing from the backup');
});
