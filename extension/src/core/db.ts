import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Answer, Product, Question } from './types';

export const DB_NAME = 'snipcue';
export const DB_VERSION = 2;

export interface SnipCueDB extends DBSchema {
  products: { key: string; value: Product };
  questions: { key: string; value: Question; indexes: { by_product: string } };
  answers: { key: string; value: Answer; indexes: { by_question: string } };
}

export const ALL_STORES = ['products', 'questions', 'answers'] as const;
export type StoreName = typeof ALL_STORES[number];
export type DB = IDBPDatabase<SnipCueDB>;

let dbPromise: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB<SnipCueDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
        db.createObjectStore('products', { keyPath: 'id' });
        db.createObjectStore('questions', { keyPath: 'id' }).createIndex('by_product', 'product_id');
        db.createObjectStore('answers', { keyPath: 'id' }).createIndex('by_question', 'question_id');
      },
      blocked() {
        console.warn('[snipcue] Close other SnipCue views to finish the database reset.');
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export function resetDbForTests(): void {
  dbPromise = null;
}
