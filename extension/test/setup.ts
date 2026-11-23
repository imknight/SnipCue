import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { resetDbForTests } from '../src/core/db';

beforeEach(() => {
  // Fresh, empty database for every test.
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});
