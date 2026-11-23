import { useRef, useState } from 'react';
import { addPastedAnswers } from '../core/library';
import { answerImportPrompt, parsePastedAnswers, previewPastedAnswers } from '../core/portable';
import type { DraftQuestion, LibrarySnapshot, Product } from '../core/types';
import { copyText } from './hooks';

export type Notify = (text: string, kind?: 'ok' | 'err') => void;

export function CopyPrompt({ product, snapshot, notify, label = 'Copy AI prompt' }: { product: Product; snapshot: LibrarySnapshot; notify: Notify; label?: string }) {
  return (
    <button type="button" onClick={async () => {
      const copied = await copyText(answerImportPrompt(product, snapshot));
      notify(copied ? (product.feed_url ? 'Prompt copied.' : 'Prompt copied. Paste it into your product chat.') : 'Clipboard access was blocked.', copied ? 'ok' : 'err');
    }}>
      {label}
    </button>
  );
}

export function PasteAnswers({ product, snapshot, notify, onClose }: { product: Product; snapshot: LibrarySnapshot; notify: Notify; onClose: () => void }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<DraftQuestion[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = draft ? previewPastedAnswers(snapshot, product.id, draft) : [];
  const selected = rows.flatMap((q, i) => {
    const answers = q.answers.filter((a, j) => !a.alreadySaved && !skipped.has(`${i}:${j}`))
      .map(({ label, text }) => label ? { label, text } : { text });
    return answers.length ? [{ question: q.question, answers }] : [];
  });
  const hasSelected = selected.length > 0;

  async function save() {
    setError('');
    setBusy(true);
    try {
      const { answers } = await addPastedAnswers(product, selected);
      notify(answers ? `Saved ${answers} answer${answers === 1 ? '' : 's'}.` : 'Those answers are already saved.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack paste-view" aria-labelledby="paste-title">
      <h2 id="paste-title" ref={heading} tabIndex={-1}>{draft ? 'Review AI answers' : 'Paste AI answers'}</h2>
      {draft ? (
        <>
          <ul className="paste-questions" role="list">
            {rows.map((q, i) => (
              <li key={q.question} className="stack">
                <h3>{q.question}</h3>
                <ul className="paste-answers" role="list">
                  {q.answers.map((a, j) => {
                    const key = `${i}:${j}`;
                    return (
                      <li key={a.text} className="paste-answer">
                        {a.alreadySaved ? (
                          <div className="stack">
                            <div><span className="badge">Already saved</span>{a.label && <strong> {a.label}</strong>}</div>
                            <span className="answer-text">{a.text}</span>
                          </div>
                        ) : (
                          <label className="paste-choice">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!skipped.has(key)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setSkipped((previous) => {
                                  const next = new Set(previous);
                                  if (checked) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                              }}
                            />
                            <span>
                              {a.label && <strong>{a.label}</strong>}
                              <span className="answer-text">{a.text}</span>
                            </span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {error && <p className="notice err" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="primary" onClick={save} disabled={busy || !hasSelected}>Save selected answers</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setDraft(null); }}>Edit paste</button>
            <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={(event) => {
          event.preventDefault();
          try {
            setDraft(parsePastedAnswers(text, product));
            setSkipped(new Set());
            setError('');
            heading.current?.focus();
          } catch (e) {
            setError((e as Error).message);
          }
        }}>
          <label>
            AI reply for {product.name}
            <textarea
              id="ai-reply"
              rows={7}
              value={text}
              onChange={(event) => { setText(event.target.value); setError(''); }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'ai-reply-error' : undefined}
              required
              autoFocus
            />
          </label>
          {error && (
            <div className="stack">
              <p id="ai-reply-error" className="notice err" role="alert">{error}</p>
              <div>
                <button type="button" onClick={async () => {
                  const copied = await copyText(`SnipCue reported this error for ${JSON.stringify(product.name)}:\n${error}\nReturn only the corrected JSON in the format from my SnipCue prompt.`);
                  notify(copied ? 'Error copied.' : 'Clipboard access was blocked.', copied ? 'ok' : 'err');
                }}>
                  Copy error for AI
                </button>
              </div>
            </div>
          )}
          <div className="row">
            <button type="submit" className="primary" disabled={!text.trim()}>Review answers</button>
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
