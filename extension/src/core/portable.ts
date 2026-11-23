import type { AnswerInput, DraftProduct, DraftQuestion, LibrarySnapshot, Product } from './types';
import { isUuid, nameKey, questionKey } from './util';
import { LIMITS, readAnswer, readFeedUrl, readQuestion, requiredText } from './validate';

const BACKUP_FORMAT = 'snipcue.library';
export const BACKUP_VERSION = 2;
const MAX_BYTES = 50 * 1024 * 1024;

function readJson(input: string, pasted: boolean): unknown {
  if (new Blob([input]).size > MAX_BYTES) throw new Error('Imports are limited to 50 MB.');
  const text = input.trim();
  try {
    return JSON.parse(text);
  } catch {
    if (!pasted) throw new Error('This file is not valid JSON.');
  }

  const blocks = [...text.matchAll(/^[ \t]{0,3}(\x60{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*\r?$/gm)];
  if (blocks.length > 1) throw new Error('Paste only one JSON block from the reply.');
  const block = blocks[0];
  if (block && !/^(?:json)?$/i.test(block[2].trim())) throw new Error('Paste the JSON block from the reply.');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    return JSON.parse(block ? block[3] : start < 0 ? '' : text.slice(start, end + 1));
  } catch {
    throw new Error('The reply does not contain a valid JSON object. Ask the AI to return only the JSON from the prompt.');
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
  return value;
}

export function parsePastedAnswers(input: string, product: Product): DraftQuestion[] {
  return parseAnswerBatch(input, product, true);
}

export function parseFeed(input: string, product: Product): DraftQuestion[] {
  return parseAnswerBatch(input, product, false);
}

function parseAnswerBatch(input: string, product: Product, pasted: boolean): DraftQuestion[] {
  const batch = record(readJson(input, pasted), pasted ? 'The reply' : 'The feed');
  if (typeof batch.product !== 'string' || nameKey(batch.product) !== nameKey(product.name)) {
    throw new Error(pasted
      ? `The reply must use “${product.name}” as its product name. Copy this product’s AI prompt and try again.`
      : `The feed must use “${product.name}” as its product name.`);
  }

  const questions = list(batch.answers, 'The answers field');
  if (pasted && questions.length === 0) throw new Error('The reply must contain at least one question with an answer.');
  return questions.map((item, i) => {
    const field = `Question ${i + 1}`;
    const row = record(item, field);
    const question = readQuestion(row.question, field);
    const answers = list(row.answers, `${field} answers`);
    if (answers.length === 0) throw new Error(`${field} must include at least one answer.`);
    return {
      question,
      answers: answers.map((answer, j) => {
        const field = `Question ${i + 1}, answer ${j + 1}`;
        return readAnswer(record(answer, field), field);
      }),
    };
  });
}

export function previewPastedAnswers(snapshot: LibrarySnapshot, productId: string, drafts: DraftQuestion[]) {
  const questions = new Map(snapshot.questions.filter((q) => q.product_id === productId).map((q) => [questionKey(q.question), q]));
  const saved = new Map<string, Map<string, AnswerInput>>();
  for (const a of snapshot.answers) {
    if (!saved.has(a.question_id)) saved.set(a.question_id, new Map());
    saved.get(a.question_id)!.set(a.text, a);
  }

  const groups = new Map<string, { question: string; answers: Map<string, { label?: string; text: string; alreadySaved: boolean }> }>();
  for (const q of drafts) {
    const key = questionKey(q.question);
    const existing = questions.get(key);
    if (!groups.has(key)) groups.set(key, { question: existing?.question ?? q.question, answers: new Map() });
    const group = groups.get(key)!;
    for (const a of q.answers) {
      if (group.answers.has(a.text)) continue;
      const savedAnswer = existing && saved.get(existing.id)?.get(a.text);
      const { label, text } = savedAnswer ?? a;
      group.answers.set(text, { ...(label ? { label } : {}), text, alreadySaved: !!savedAnswer });
    }
  }
  return [...groups.values()].map((group) => ({ question: group.question, answers: [...group.answers.values()] }));
}

export function answerImportPrompt(product: Product, snapshot: LibrarySnapshot): string {
  const answeredIds = new Set(snapshot.answers.map((a) => a.question_id));
  const pending: string[] = [];
  const answered: string[] = [];
  for (const q of snapshot.questions) {
    if (q.product_id === product.id) {
      (answeredIds.has(q.id) ? answered : pending).push(`- ${JSON.stringify(q.question)}`);
    }
  }
  const request = pending.length
    ? `Answer these questions\n${pending.join('\n')}\n\nKeep their wording so SnipCue can match them.`
    : 'Suggest common customer questions and answer them.';
  const format = JSON.stringify({ product: product.name, answers: [{ question: 'Example question?', answers: [{ label: 'Optional label', text: 'Plain-text reply' }] }] }, null, 2);
  if (product.feed_url) {
    return `Update this JSON file: add answers for these open questions, keep existing entries.
${product.feed_url}

Prepare reusable answers for ${JSON.stringify(product.name)} using verified product facts. Ask me about missing facts before drafting.

${request}

Already answered (don't repeat)
${answered.join('\n') || '(none)'}

Edit the source JSON file in the repository. Use plain text and omit the label if unnecessary. Keep this JSON format:

${format}`;
  }
  return `Prepare reusable answers for my product ${JSON.stringify(product.name)}. Use facts established in this chat and ask me about any missing facts before drafting.

${request}

Already answered (don't repeat)
${answered.join('\n') || '(none)'}

Use plain text and omit the label if it is unnecessary. Reply with only one JSON object in this format, without Markdown or commentary.

${format}`;
}

export function buildBackup(snapshot: LibrarySnapshot) {
  const products = snapshot.products.map(({ id, name, feed_url }) => ({ id, name, ...(feed_url ? { feed_url } : {}) }));
  const answers = snapshot.answers.map(({ id, question_id, text, label }) => ({ id, question_id, text, ...(label ? { label } : {}) }));
  return { format: BACKUP_FORMAT, schema_version: BACKUP_VERSION, products, questions: snapshot.questions, answers };
}

export function parseBackup(input: string): DraftProduct[] {
  const file = record(readJson(input, false), 'The backup');
  if (file.format !== BACKUP_FORMAT || file.schema_version !== BACKUP_VERSION) {
    throw new Error(`Choose a SnipCue backup with schema version ${BACKUP_VERSION}.`);
  }

  const ids = new Set<string>();
  const readId = (value: unknown, field: string) => {
    if (!isUuid(value) || ids.has(value)) throw new Error(`${field} must be a unique ID.`);
    ids.add(value);
    return value;
  };

  const products = new Map<string, DraftProduct>();
  for (const item of list(file.products, 'Products')) {
    const row = record(item, 'Product');
    const id = readId(row.id, 'Product ID');
    const feed_url = row.feed_url === undefined ? undefined : readFeedUrl(row.feed_url);
    products.set(id, { name: requiredText(row.name, 'Product name', LIMITS.name), ...(feed_url ? { feed_url } : {}), questions: [] });
  }

  const questions = new Map<string, DraftQuestion>();
  for (const item of list(file.questions, 'Questions')) {
    const row = record(item, 'Question');
    const id = readId(row.id, 'Question ID');
    const product = typeof row.product_id === 'string' ? products.get(row.product_id) : undefined;
    if (!product) throw new Error('A question refers to a product missing from the backup.');
    const { created_at, updated_at } = row;
    if (typeof created_at !== 'string' || Number.isNaN(Date.parse(created_at))
      || typeof updated_at !== 'string' || Number.isNaN(Date.parse(updated_at))) {
      throw new Error('Each question must have valid creation and update dates.');
    }
    const question: DraftQuestion = { question: readQuestion(row.question), created_at, updated_at, answers: [], ...(row.local_open === true ? { local_open: true } : {}) };
    product.questions.push(question);
    questions.set(id, question);
  }

  for (const item of list(file.answers, 'Answers')) {
    const row = record(item, 'Answer');
    readId(row.id, 'Answer ID');
    const question = typeof row.question_id === 'string' ? questions.get(row.question_id) : undefined;
    if (!question) throw new Error('An answer refers to a question missing from the backup.');
    question.answers.push(readAnswer(row));
  }

  return [...products.values()];
}
