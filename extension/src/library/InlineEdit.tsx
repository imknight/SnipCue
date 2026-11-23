import { useEffect, useRef, useState } from 'react';
import type { AnswerInput } from '../core/types';

type CloseEditor = (saved: boolean, restoreFocus: boolean) => void;
const compareAnswer = (a: AnswerInput, b: AnswerInput) => a.text === b.text && (a.label ?? '') === (b.label ?? '');
const compareText = (a: string, b: string) => a === b;

function useInlineEdit<T>(initial: T, save: (value: T) => Promise<void>, close: CloseEditor, equals: (a: T, b: T) => boolean, idle: boolean) {
  const original = useRef(initial);
  const persisted = useRef(initial);
  const value = useRef(initial);
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState({ text: '', error: false });
  const timer = useRef<number>();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const closing = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function commit(next: T) {
    const pending = queue.current.then(async () => {
      if (equals(persisted.current, next)) {
        setStatus({ text: '', error: false });
        return true;
      }
      setStatus({ text: 'Saving…', error: false });
      try {
        await save(next);
        persisted.current = next;
        setStatus({ text: 'Saved ✓', error: false });
        return true;
      } catch (e) {
        setStatus({ text: (e as Error).message, error: true });
        return false;
      }
    });
    queue.current = pending;
    return pending;
  }

  function change(next: T) {
    value.current = next;
    setDraft(next);
    window.clearTimeout(timer.current);
    setStatus({ text: idle ? 'Saving…' : '', error: false });
    if (idle) timer.current = window.setTimeout(() => void commit(value.current), 800);
  }

  async function finish(revert: boolean, restoreFocus: boolean) {
    if (closing.current) return;
    closing.current = true;
    window.clearTimeout(timer.current);
    const saved = await commit(revert ? original.current : value.current);
    if (saved) close(!revert && !equals(original.current, persisted.current), restoreFocus);
    else closing.current = false;
  }

  return { draft, status, change, finish };
}

export function SaveStatus({ text, error = false }: { text: string; error?: boolean }) {
  return <span className={`small save-status ${error ? 'save-error' : 'muted'}`} role={error ? 'alert' : 'status'}>{text}</span>;
}

export function InlineText({ label, value, save, close, idle = true }: {
  label: string; value: string; save: (value: string) => Promise<void>; close: CloseEditor; idle?: boolean;
}) {
  const edit = useInlineEdit(value, save, close, compareText, idle);
  return (
    <div className="inline-title-edit">
      <input type="text" aria-label={label} value={edit.draft} onChange={(event) => edit.change(event.target.value)}
        onBlur={() => void edit.finish(false, false)} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault();
            void edit.finish(event.key === 'Escape', true);
          }
        }} autoFocus />
      <SaveStatus {...edit.status} />
    </div>
  );
}

export function AnswerFields({ value, onChange, optional = false, focusText = false }: {
  value: AnswerInput; onChange: (answer: AnswerInput) => void; optional?: boolean; focusText?: boolean;
}) {
  return (
    <>
      <label>
        Label (optional)
        <input type="text" value={value.label ?? ''} onChange={(event) => onChange({ ...value, label: event.target.value })} />
      </label>
      <label>
        {optional ? 'Answer text (optional)' : 'Answer text'}
        <textarea rows={4} value={value.text} onChange={(event) => onChange({ ...value, text: event.target.value })} required={!optional} autoFocus={focusText} />
      </label>
    </>
  );
}

export function InlineAnswer({ value, save, close }: {
  value: AnswerInput; save: (value: AnswerInput) => Promise<void>; close: CloseEditor;
}) {
  const edit = useInlineEdit(value, save, close, compareAnswer, true);
  return (
    <div className="stack inline-answer-edit" role="group" aria-label="Edit answer"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) void edit.finish(false, false);
      }} onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void edit.finish(true, true);
        }
      }}>
      <AnswerFields value={edit.draft} onChange={edit.change} focusText />
      <SaveStatus {...edit.status} />
    </div>
  );
}
