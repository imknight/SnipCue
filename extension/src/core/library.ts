import type { IDBPTransaction } from 'idb';
import { ALL_STORES, getDb, type SnipCueDB, type StoreName } from './db';
import type { Answer, AnswerInput, DraftProduct, DraftQuestion, FeedState, LibrarySnapshot, Product, Question } from './types';
import { nameKey, now, questionKey, uuid } from './util';
import { LIMITS, readAnswer, readQuestion, requiredText } from './validate';

type ReadTx = IDBPTransaction<SnipCueDB, readonly StoreName[], 'readonly' | 'readwrite'>;
type WriteTx = IDBPTransaction<SnipCueDB, readonly StoreName[], 'readwrite'>;

export const CHANGE_CHANNEL = 'snipcue-library';

async function write<T>(stores: readonly StoreName[], apply: (tx: WriteTx) => Promise<T>): Promise<T> {
  const tx = (await getDb()).transaction(stores, 'readwrite');
  try {
    const result = await apply(tx);
    await tx.done;
    const channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.postMessage('changed');
    channel.close();
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction has already ended. */ }
    await tx.done.catch(() => undefined);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Browser storage is full. Export a backup and free up space before saving.');
    }
    throw error;
  }
}

async function snapshotFrom(tx: ReadTx): Promise<LibrarySnapshot> {
  const [products, questions, answers] = await Promise.all([
    tx.objectStore('products').getAll(),
    tx.objectStore('questions').getAll(),
    tx.objectStore('answers').getAll(),
  ]);
  return { products, questions, answers };
}

export async function loadSnapshot(): Promise<LibrarySnapshot> {
  const tx = (await getDb()).transaction(ALL_STORES, 'readonly');
  const snapshot = await snapshotFrom(tx);
  await tx.done;
  return snapshot;
}

function newQuestion(productId: string, question: string): Question {
  const ts = now();
  return { id: uuid(), product_id: productId, question, created_at: ts, updated_at: ts };
}

export async function createProduct(value: string, firstQuestion?: string): Promise<Product> {
  const product = { id: uuid(), name: requiredText(value, 'Product name', LIMITS.name) };
  const question = firstQuestion === undefined ? null : newQuestion(product.id, readQuestion(firstQuestion));
  return write(question ? ['products', 'questions'] : ['products'], async (tx) => {
    const store = tx.objectStore('products');
    if ((await store.getAll()).some((p) => nameKey(p.name) === nameKey(product.name))) throw new Error('A product with that name already exists.');
    await store.add(product);
    if (question) await tx.objectStore('questions').add(question);
    return product;
  });
}

export async function renameProduct(id: string, value: string): Promise<void> {
  const name = requiredText(value, 'Product name', LIMITS.name);
  await write(['products'], async (tx) => {
    const store = tx.objectStore('products');
    const product = await store.get(id);
    if (!product) throw new Error('This product no longer exists.');
    if ((await store.getAll()).some((p) => p.id !== id && nameKey(p.name) === nameKey(name))) throw new Error('A product with that name already exists.');
    await store.put({ ...product, name, feed: undefined });
  });
}

export async function createQuestion(productId: string, value: string, input?: AnswerInput): Promise<boolean> {
  const question = newQuestion(productId, readQuestion(value));
  const answer = input && readAnswer(input);
  return write(ALL_STORES, async (tx) => {
    const product = await tx.objectStore('products').get(productId);
    if (!product) throw new Error('This product no longer exists.');
    if (product.feed_url && answer) throw new Error('Edit the source file to add feed answers.');
    const store = tx.objectStore('questions');
    const existing = await store.index('by_product').getAll(productId);
    if (existing.some((q) => questionKey(q.question) === questionKey(question.question))) return false;
    await store.add(product.feed_url ? { ...question, local_open: true } : question);
    if (answer) await tx.objectStore('answers').add({ id: uuid(), question_id: question.id, ...answer });
    return true;
  });
}

export async function renameQuestion(id: string, value: string): Promise<void> {
  const question = readQuestion(value);
  await write(ALL_STORES, async (tx) => {
    const store = tx.objectStore('questions');
    const row = await store.get(id);
    if (!row) throw new Error('This question no longer exists.');
    await checkQuestionEditable(tx, row, true);
    const existing = await store.index('by_product').getAll(row.product_id);
    if (existing.some((q) => q.id !== id && questionKey(q.question) === questionKey(question))) throw new Error('A question with that wording already exists.');
    await store.put({ ...row, question, updated_at: now() });
  });
}

export async function createAnswer(questionId: string, input: AnswerInput): Promise<void> {
  const answer = { id: uuid(), question_id: questionId, ...readAnswer(input) };
  await write(ALL_STORES, async (tx) => {
    const question = await tx.objectStore('questions').get(questionId);
    if (!question) throw new Error('This question no longer exists.');
    await checkQuestionEditable(tx, question);
    await tx.objectStore('answers').add(answer);
  });
}

export async function updateAnswer(id: string, input: AnswerInput): Promise<void> {
  const answer = readAnswer(input);
  await write(ALL_STORES, async (tx) => {
    const store = tx.objectStore('answers');
    const row = await store.get(id);
    if (!row) throw new Error('This answer no longer exists.');
    await checkQuestionEditable(tx, (await tx.objectStore('questions').get(row.question_id))!);
    await store.put({ id, question_id: row.question_id, ...answer });
  });
}

async function checkQuestionEditable(tx: WriteTx, question: Question, allowOpen = false) {
  const product = await tx.objectStore('products').get(question.product_id);
  if (product?.feed_url && (!allowOpen || await tx.objectStore('answers').index('by_question').count(question.id))) {
    throw new Error('Edit the source file to change feed questions or answers.');
  }
}

async function removeQuestion(tx: WriteTx, id: string): Promise<void> {
  const answers = tx.objectStore('answers');
  for (const key of await answers.index('by_question').getAllKeys(id)) await answers.delete(key);
  await tx.objectStore('questions').delete(id);
}

export async function deleteProduct(id: string): Promise<void> {
  await write(ALL_STORES, async (tx) => {
    for (const key of await tx.objectStore('questions').index('by_product').getAllKeys(id)) await removeQuestion(tx, key);
    await tx.objectStore('products').delete(id);
  });
}

export async function deleteQuestion(id: string): Promise<void> {
  await write(ALL_STORES, async (tx) => {
    const question = await tx.objectStore('questions').get(id);
    if (!question) return;
    await checkQuestionEditable(tx, question, true);
    await removeQuestion(tx, id);
  });
}

export async function deleteAnswer(id: string): Promise<void> {
  await write(ALL_STORES, async (tx) => {
    const answer = await tx.objectStore('answers').get(id);
    if (!answer) return;
    await checkQuestionEditable(tx, (await tx.objectStore('questions').get(answer.question_id))!);
    await tx.objectStore('answers').delete(id);
  });
}

export function recordsToAdd(snapshot: LibrarySnapshot, products: DraftProduct[]): LibrarySnapshot {
  const additions: LibrarySnapshot = { products: [], questions: [], answers: [] };
  const savedProducts = new Map(snapshot.products.map((p) => [nameKey(p.name), p]));
  const productIds = new Map(snapshot.products.map((p) => [nameKey(p.name), p.id]));
  const questionIds = new Map(snapshot.questions.map((q) => [`${q.product_id}|${questionKey(q.question)}`, q.id]));
  const texts = new Map<string, Set<string>>();
  for (const a of snapshot.answers) {
    if (!texts.has(a.question_id)) texts.set(a.question_id, new Set());
    texts.get(a.question_id)!.add(a.text);
  }
  const ts = now();
  for (const draft of products) {
    const key = nameKey(draft.name);
    let productId = productIds.get(key);
    if (!productId) {
      productId = uuid();
      productIds.set(key, productId);
      additions.products.push({ id: productId, name: draft.name, ...(draft.feed_url ? { feed_url: draft.feed_url } : {}) });
    }
    const savedFeed = savedProducts.get(key)?.feed_url;
    for (const q of draft.questions) {
      if (savedFeed && q.answers.length && !q.local_open) continue;
      const key = `${productId}|${questionKey(q.question)}`;
      let questionId = questionIds.get(key);
      if (!questionId) {
        questionId = uuid();
        questionIds.set(key, questionId);
        additions.questions.push({
          id: questionId, product_id: productId, question: q.question, created_at: q.created_at ?? ts, updated_at: q.updated_at ?? ts,
          ...(q.local_open || savedFeed ? { local_open: true } : {}),
        });
      }
      if (savedFeed) continue;
      if (!texts.has(questionId)) texts.set(questionId, new Set());
      const saved = texts.get(questionId)!;
      for (const a of q.answers) {
        if (saved.has(a.text)) continue;
        saved.add(a.text);
        additions.answers.push({ id: uuid(), question_id: questionId, ...a });
      }
    }
  }
  return additions;
}

async function addToLibrary(tx: WriteTx, snapshot: LibrarySnapshot, input: DraftProduct[]) {
  const additions = recordsToAdd(snapshot, input);
  for (const p of additions.products) await tx.objectStore('products').add(p);
  for (const q of additions.questions) await tx.objectStore('questions').add(q);
  for (const a of additions.answers) await tx.objectStore('answers').add(a);
  return { products: additions.products.length, questions: additions.questions.length, answers: additions.answers.length };
}

export async function addBackup(input: DraftProduct[]) {
  return write(ALL_STORES, async (tx) => addToLibrary(tx, await snapshotFrom(tx), input));
}

export async function addPastedAnswers(product: Product, questions: DraftQuestion[]) {
  return write(ALL_STORES, async (tx) => {
    const snapshot = await snapshotFrom(tx);
    const current = snapshot.products.find((p) => p.id === product.id);
    if (!current || nameKey(current.name) !== nameKey(product.name)) throw new Error('This product changed. Copy its current AI prompt and preview the reply again.');
    if (current.feed_url) throw new Error('Edit the source file to add feed answers.');
    return addToLibrary(tx, snapshot, [{ name: current.name, questions }]);
  });
}

export async function beginFeedRefresh(productId: string, force: boolean): Promise<Product | undefined> {
  return write(['products'], async (tx) => {
    const store = tx.objectStore('products');
    const product = await store.get(productId);
    if (!product?.feed_url) return;
    const time = Date.now();
    const lastCheck = product.feed?.checked_at ?? 0;
    if (!force && product.feed && time - lastCheck < 5 * 60_000) return;
    const next = { ...product, feed: { ...product.feed, checked_at: Math.max(time, lastCheck + 1) } };
    await store.put(next);
    return next;
  });
}

export async function commitFeed(product: Product, feedUrl?: string, feed?: FeedState, drafts?: DraftQuestion[]): Promise<boolean> {
  return write(ALL_STORES, async (tx) => {
    const products = tx.objectStore('products');
    const current = await products.get(product.id);
    if (!current || current.name !== product.name || current.feed_url !== product.feed_url
      || (feedUrl === product.feed_url && current.feed?.checked_at !== product.feed?.checked_at)) return false;

    if (drafts) {
      const questionStore = tx.objectStore('questions');
      const answerStore = tx.objectStore('answers');
      const questions = await questionStore.index('by_product').getAll(product.id);
      const answers = (await Promise.all(questions.map((q) => answerStore.index('by_question').getAll(q.id)))).flat();
      const answeredIds = new Set(answers.map((a) => a.question_id));
      const incoming = new Map(drafts.map((q) => [questionKey(q.question), q.question]));
      const kept: Question[] = [];
      for (const question of questions) {
        if (question.local_open || !answeredIds.has(question.id)) {
          const local = { ...question, local_open: true } as const;
          if (!question.local_open) await questionStore.put(local);
          kept.push(local);
        } else if (incoming.has(questionKey(question.question))) {
          const wording = incoming.get(questionKey(question.question))!;
          const next = wording === question.question ? question : { ...question, question: wording, updated_at: now() };
          if (next !== question) await questionStore.put(next);
          kept.push(next);
        } else {
          await questionStore.delete(question.id);
        }
      }
      const matchingProduct = { id: product.id, name: product.name };
      const next = recordsToAdd({ products: [matchingProduct], questions: kept, answers: [] }, [{ name: product.name, questions: drafts }]);
      for (const question of next.questions) await questionStore.add(question);
      const answerIds = new Map(answers.map((a) => [JSON.stringify([a.question_id, a.text]), a.id]));
      const retained = new Set<string>();
      for (const answer of next.answers) {
        const id = answerIds.get(JSON.stringify([answer.question_id, answer.text])) ?? answer.id;
        await answerStore.put({ ...answer, id });
        retained.add(id);
      }
      for (const answer of answers) {
        if (!retained.has(answer.id)) await answerStore.delete(answer.id);
      }
    }
    await products.put({ id: current.id, name: current.name, ...(feedUrl ? { feed_url: feedUrl, feed } : {}) });
    return true;
  });
}
