import { useEffect, useRef, useState } from 'react';
import type { Toast } from './hooks';

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((toast) => <ToastMessage key={toast.id} toast={toast} dismiss={dismiss} />)}
    </div>
  );
}

function ToastMessage({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  const [focused, setFocused] = useState(false);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (focused || restoring) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toast.undo ? 6000 : toast.kind === 'err' ? 7000 : 3000);
    return () => window.clearTimeout(timer);
  }, [dismiss, focused, restoring, toast]);

  return (
    <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>
      {toast.text}
      {toast.undo && <>
        {' · '}
        <button type="button" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          disabled={restoring} onClick={async () => {
            setRestoring(true);
            if (await toast.undo!()) dismiss(toast.id);
            else setRestoring(false);
          }}>Undo</button>
      </>}
    </div>
  );
}

export function ManualCopy({ text, onDone, onCopy }: { text: string; onDone: () => void; onCopy?: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="notice warn stack">
      <p>Clipboard access was blocked. Use your copy shortcut to copy the selected text.</p>
      <textarea ref={ref} readOnly value={text} onCopy={onCopy} rows={Math.min(10, text.split('\n').length + 1)} aria-label="Answer text to copy manually" />
      <div><button type="button" onClick={onDone}>Done</button></div>
    </div>
  );
}
