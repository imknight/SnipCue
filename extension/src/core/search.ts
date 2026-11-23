import type { Answer, LibrarySnapshot, Product, Question } from './types';
import { searchFold } from './util';

interface SearchEntry {
  answer: Answer;
  question: Question;
  product: Product;
  terms: [string, string, string];
}

export function buildIndex({ products, questions, answers }: LibrarySnapshot): SearchEntry[] {
  const productsById = new Map(products.map((p) => [p.id, p]));
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  return answers.map((answer) => {
    const question = questionsById.get(answer.question_id)!;
    const product = productsById.get(question.product_id)!;
    return { answer, question, product, terms: [searchFold(question.question), searchFold(answer.label ?? ''), searchFold(answer.text)] };
  });
}

export function searchAnswers(index: SearchEntry[], query: string, productId?: string | null): SearchEntry[] {
  const terms = searchFold(query).split(/\s+/).filter(Boolean);
  const now = Date.now();
  const matches = [];
  for (const entry of index) {
    if (productId && entry.product.id !== productId) continue;
    const scores = terms.map((term) => {
      const position = entry.terms.findIndex((field) => field.includes(term));
      return position === -1 ? 0 : entry.terms.length - position;
    });
    if (scores.includes(0)) continue;
    const { answer, question } = entry;
    const ageInWeeks = answer.lastCopiedAt ? Math.max(0, now - answer.lastCopiedAt) / 604_800_000 : Infinity;
    const usage = Math.log2(1 + (answer.copyCount ?? 0)) * 2 ** -ageInWeeks;
    matches.push({
      entry,
      score: scores.reduce((sum, score) => sum + score, 0),
      usage,
      created: Date.parse(answer.created_at ?? question.created_at),
    });
  }
  return matches.sort((a, b) =>
    b.score - a.score
    || b.usage - a.usage
    || b.created - a.created
    || a.entry.question.question.localeCompare(b.entry.question.question)
    || (a.entry.answer.label ?? '').localeCompare(b.entry.answer.label ?? '')
    || a.entry.answer.text.localeCompare(b.entry.answer.text),
  ).map(({ entry }) => entry);
}
