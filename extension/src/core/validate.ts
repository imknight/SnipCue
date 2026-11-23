import type { AnswerInput } from './types';
import { normalizeQuestion } from './util';

export const LIMITS = { name: 120, question: 500, label: 80, text: 20_000 };

export function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be non-empty text.`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} must be at most ${max} characters.`);
  return text;
}

export function readAnswer(value: { text?: unknown; label?: unknown }, field = 'Answer'): AnswerInput {
  const text = requiredText(value.text, `${field} text`, LIMITS.text);
  if (value.label !== undefined && typeof value.label !== 'string') throw new Error(`${field} label must be text.`);
  const label = value.label?.trim();
  if (label && label.length > LIMITS.label) throw new Error(`${field} label must be at most ${LIMITS.label} characters.`);
  return { ...(label ? { label } : {}), text };
}

export function readQuestion(value: unknown, field = 'Question'): string {
  return requiredText(typeof value === 'string' ? normalizeQuestion(value) : value, field, LIMITS.question);
}

export function readFeedUrl(value: unknown): string {
  let url: URL | undefined;
  if (typeof value === 'string') {
    try { url = new URL(value.trim()); } catch { /* Report the HTTPS requirement below. */ }
  }
  if (url?.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Enter an HTTPS feed URL without a username or password.');
  }
  url.hash = '';
  return url.href;
}
