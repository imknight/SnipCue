import { openDB } from 'idb';
import { DB_NAME, DB_VERSION, getDb } from '../src/core/db';
import { addPastedAnswers, createProduct, createQuestion, deleteAnswer, deleteProduct, deleteQuestion, loadSnapshot, recordAnswerCopy, restoreDeleted } from '../src/core/library';
import { answerImportPrompt, buildBackup, parsePastedAnswers, previewPastedAnswers } from '../src/core/portable';
import { buildIndex, searchAnswers } from '../src/core/search';

it('recreates the database on upgrade with only the new stores', async () => {
  const old = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('products');
      db.createObjectStore('retired');
    },
  });
  await old.put('products', { name: 'Old product' }, 'old');
  old.close();

  const current = await getDb();
  expect(current.version).toBe(DB_VERSION);
  expect([...current.objectStoreNames]).toEqual(['answers', 'products', 'questions']);
  expect(await loadSnapshot()).toEqual({ products: [], questions: [], answers: [] });
});

it('matches an existing question by trimmed, case-insensitive wording and skips identical text', async () => {
  const product = await createProduct('Field Notes');
  const other = await createProduct('Other');
  await createQuestion(product.id, 'Can I work offline?', { label: 'Short', text: 'Yes, offline works.' });
  await createQuestion(other.id, 'Can I work offline?', { text: 'Other product answer.' });
  const reply = parsePastedAnswers(JSON.stringify({
    product: '  field NOTES ',
    answers: [
      { question: '  CAN I WORK OFFLINE?  ', answers: [{ label: 'Changed label', text: 'Yes, offline works.' }, { text: 'You can edit offline.' }] },
      { question: 'Can I work offline?', answers: [{ label: 'Duplicate', text: 'You can edit offline.' }] },
    ],
  }), product);
  const before = await loadSnapshot();
  expect(previewPastedAnswers(before, product.id, reply)).toEqual([{
    question: 'Can I work offline?',
    answers: [
      { label: 'Short', text: 'Yes, offline works.', alreadySaved: true },
      { text: 'You can edit offline.', alreadySaved: false },
    ],
  }]);
  expect(await loadSnapshot()).toEqual(before);
  const results = await Promise.all([addPastedAnswers(product, reply), addPastedAnswers(product, reply)]);
  expect(results.map((r) => r.answers).sort()).toEqual([0, 1]);
  const saved = await loadSnapshot();
  expect(saved.questions).toEqual(before.questions);
  expect(saved.answers).toHaveLength(3);
  expect(saved.answers.find((a) => a.text === 'Yes, offline works.')?.label).toBe('Short');
  expect(saved.answers.find((a) => a.text === 'You can edit offline.')?.question_id).toBe(before.questions.find((q) => q.product_id === product.id)?.id);
  expect(previewPastedAnswers(saved, product.id, reply)[0].answers.every((a) => a.alreadySaved)).toBe(true);
});

it('searches questions, labels, and body text by relevance with a product filter', async () => {
  const product = await createProduct('Field Notes');
  const other = await createProduct('Other');
  await createQuestion(product.id, 'Offline workflow?', { label: '中文', text: 'Read the guide.' });
  await createQuestion(product.id, 'How do I get started?', { label: 'Offline', text: 'Setup instructions.' });
  await createQuestion(other.id, 'How do I open it?', { text: 'It works offline.' });
  const index = buildIndex(await loadSnapshot());

  expect(searchAnswers(index, 'OFFLINE').map((entry) => entry.question.question)).toEqual([
    'Offline workflow?', 'How do I get started?', 'How do I open it?',
  ]);
  expect(searchAnswers(index, '中文 guide').map((entry) => entry.answer.text)).toEqual(['Read the guide.']);
  expect(searchAnswers(index, 'offline', other.id)).toHaveLength(1);
  expect(searchAnswers(index, '中文', other.id)).toEqual([]);
});

it('ranks recent copies over old heavy use, then newest, with relevance first in a search', async () => {
  const product = await createProduct('Field Notes');
  await createQuestion(product.id, 'Offline details?', { text: 'Matches the question.' });
  await createQuestion(product.id, 'First setup?', { text: 'Old offline answer.' });
  await createQuestion(product.id, 'Second setup?', { text: 'Recently used offline answer.' });
  await createQuestion(product.id, 'One more?', { text: 'Newest answer.' });
  const db = await getDb();
  const fixtures = await loadSnapshot();
  const old = fixtures.answers.find((answer) => answer.text.startsWith('Old'))!;
  const recent = fixtures.answers.find((answer) => answer.text.startsWith('Recently'))!;
  const newest = fixtures.answers.find((answer) => answer.text.startsWith('Newest'))!;
  const relevant = fixtures.answers.find((answer) => answer.text.startsWith('Matches'))!;
  await db.put('answers', { ...old, copyCount: 256, lastCopiedAt: Date.now() - 90 * 86_400_000 });
  await db.put('answers', { ...newest, created_at: '2026-11-23T13:00:00.000Z' });
  await db.put('answers', { ...relevant, created_at: '2026-11-23T12:00:00.000Z' });
  await Promise.all([recordAnswerCopy(recent.id), recordAnswerCopy(recent.id)]);
  const snapshot = await loadSnapshot();
  expect(snapshot.answers.find((answer) => answer.id === recent.id)).toMatchObject({ copyCount: 2, lastCopiedAt: expect.any(Number) });
  expect(searchAnswers(buildIndex(snapshot), '').map(({ answer }) => answer.id)).toEqual([recent.id, old.id, newest.id, relevant.id]);
  expect(searchAnswers(buildIndex(snapshot), 'offline').map(({ answer }) => answer.id)).toEqual([relevant.id, recent.id, old.id]);
  expect(buildBackup(snapshot).answers.find((answer) => answer.id === recent.id)).not.toHaveProperty('copyCount');
  expect(buildBackup(snapshot).answers.find((answer) => answer.id === recent.id)).not.toHaveProperty('lastCopiedAt');
});

it('restores exact deleted answer, question, open question, and product records without creating orphans', async () => {
  const product = await createProduct('Field Notes', 'Open question?');
  await createQuestion(product.id, 'Can I work offline?', { label: 'Short', text: 'Yes.' });
  const answer = (await loadSnapshot()).answers[0];
  await recordAnswerCopy(answer.id);
  const before = await loadSnapshot();
  const removedAnswer = (await deleteAnswer(answer.id))!;
  const removedQuestion = (await deleteQuestion(answer.question_id))!;
  await expect(restoreDeleted(removedAnswer)).rejects.toThrow('Undo the question deletion first');
  expect((await loadSnapshot()).answers).toEqual([]);
  await restoreDeleted(removedQuestion);
  await restoreDeleted(removedAnswer);

  const open = before.questions.find((question) => question.question === 'Open question?')!;
  await restoreDeleted((await deleteQuestion(open.id))!);
  const removedProduct = (await deleteProduct(product.id))!;
  expect(await loadSnapshot()).toEqual({ products: [], questions: [], answers: [] });
  await restoreDeleted(removedProduct);
  expect(await loadSnapshot()).toEqual(before);
});

it('fills an existing open question with pasted answers and removes it from the open prompt section', async () => {
  const product = await createProduct('Field Notes', '  Can I export   notes?  ');
  expect(await createQuestion(product.id, 'CAN I EXPORT\n NOTES?')).toBe(false);
  const [question] = (await loadSnapshot()).questions;
  expect(question.question).toBe('Can I export notes?');
  const drafts = parsePastedAnswers(JSON.stringify({
    product: product.name,
    answers: [{ question: '  CAN I  EXPORT notes?  ', answers: [{ text: 'Yes.' }] }],
  }), product);

  const before = await loadSnapshot();
  expect(previewPastedAnswers(before, product.id, drafts)).toEqual([{ question: question.question, answers: [{ text: 'Yes.', alreadySaved: false }] }]);
  expect(before.answers).toEqual([]);
  expect(await addPastedAnswers(product, drafts)).toEqual({ products: 0, questions: 0, answers: 1 });
  const after = await loadSnapshot();
  expect(after.questions).toEqual([question]);
  expect(after.answers[0]).toMatchObject({ question_id: question.id, text: 'Yes.' });
  expect(answerImportPrompt(product, after)).not.toContain('Answer these questions');
  expect(answerImportPrompt(product, after)).toContain('Already answered (don\'t repeat)\n- "Can I export notes?"');
});
