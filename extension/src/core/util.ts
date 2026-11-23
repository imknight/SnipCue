export const uuid = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const nameKey = (text: string): string => text.trim().toLowerCase();
export const normalizeQuestion = (text: string): string => text.trim().replace(/\s+/g, ' ');
export const questionKey = (text: string): string => normalizeQuestion(text).toLowerCase();
export const searchFold = (text: string): string => text.normalize('NFKC').toLowerCase();
