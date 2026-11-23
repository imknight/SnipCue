import { useEffect, useRef } from 'react';
import type { Toast } from './hooks';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>)}
    </div>
  );
}

export function ManualCopy({ text, onDone }: { text: string; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="notice warn stack">
      <p>Clipboard access was blocked. Use your copy shortcut to copy the selected text.</p>
      <textarea ref={ref} readOnly value={text} rows={Math.min(10, text.split('\n').length + 1)} aria-label="Answer text to copy manually" />
      <div><button type="button" onClick={onDone}>Done</button></div>
    </div>
  );
}
