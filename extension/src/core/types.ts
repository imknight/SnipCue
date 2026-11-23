export interface Product {
  id: string;
  name: string;
  feed_url?: string;
  feed?: FeedState;
}

export interface FeedState {
  checked_at: number;
  synced_at?: number;
  etag?: string;
  error?: string;
}

export interface Question {
  id: string;
  product_id: string;
  question: string;
  created_at: string;
  updated_at: string;
  local_open?: true;
}

export interface AnswerInput {
  label?: string;
  text: string;
}

export interface Answer extends AnswerInput {
  id: string;
  question_id: string;
  created_at?: string;
  copyCount?: number;
  lastCopiedAt?: number;
}

export interface LibrarySnapshot {
  products: Product[];
  questions: Question[];
  answers: Answer[];
}

export interface DraftQuestion {
  question: string;
  answers: AnswerInput[];
  created_at?: string;
  updated_at?: string;
  local_open?: true;
}

export interface DraftProduct {
  name: string;
  feed_url?: string;
  questions: DraftQuestion[];
}
