import { useEffect, useMemo, useRef, useState } from 'react';
import { refreshProductFeed } from '../core/feed';
import { createAnswer, createQuestion, deleteAnswer, deleteProduct, deleteQuestion, renameProduct, renameQuestion, updateAnswer } from '../core/library';
import type { Answer, AnswerInput, LibrarySnapshot, Product, Question } from '../core/types';
import { searchFold } from '../core/util';
import { CopyPrompt, PasteAnswers, type Notify } from '../ui/PasteAnswers';
import { FeedDialog } from './FeedDialog';
import { downloadBackup, timeAgo } from './ImportExport';
import { AnswerFields, InlineAnswer, InlineText, SaveStatus } from './InlineEdit';
import { MoreActions } from './MoreActions';

type FilterMode = 'all' | 'open' | 'answered';
const initialFilter: { mode: FilterMode; query: string } = { mode: 'all', query: '' };
type DeleteWithUndo = (remove: () => Promise<LibrarySnapshot | undefined>) => Promise<void>;

export function ProductView({ product, snapshot, notify, focusAnswerId, focusQuestionId, deleteWithUndo }: {
  product: Product;
  snapshot: LibrarySnapshot;
  notify: Notify;
  focusAnswerId?: string;
  focusQuestionId?: string;
  deleteWithUndo: DeleteWithUndo;
}) {
  const filterKey = `question-filter:${product.id}`;
  const [filter, setFilter] = useState(() => {
    if (focusQuestionId) return initialFilter;
    try {
      const saved = sessionStorage.getItem(filterKey);
      return saved ? JSON.parse(saved) as typeof initialFilter : initialFilter;
    } catch {
      return initialFilter;
    }
  });
  const [editingName, setEditingName] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [adding, setAdding] = useState(false);
  const [feedSettings, setFeedSettings] = useState(false);
  const nameButton = useRef<HTMLButtonElement>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);

  const answersByQuestion = useMemo(() => {
    const grouped = new Map<string, Answer[]>();
    for (const answer of snapshot.answers) {
      const list = grouped.get(answer.question_id);
      if (list) list.push(answer);
      else grouped.set(answer.question_id, [answer]);
    }
    return grouped;
  }, [snapshot.answers]);
  const rows = snapshot.questions.filter((q) => q.product_id === product.id)
    .map((question) => ({ question, answers: answersByQuestion.get(question.id) ?? [] }))
    .sort((a, b) => Number(!!a.answers.length) - Number(!!b.answers.length) || a.question.question.localeCompare(b.question.question));
  const openCount = rows.filter((row) => !row.answers.length).length;
  const totals = { all: rows.length, open: openCount, answered: rows.length - openCount };
  const terms = searchFold(filter.query).split(/\s+/).filter(Boolean);
  const matches = rows.filter(({ question, answers }) => {
    if (filter.mode === 'open' && answers.length || filter.mode === 'answered' && !answers.length) return false;
    const fields = [question.question, ...answers.flatMap((answer) => [answer.label ?? '', answer.text])].map(searchFold);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
  const visibleIds = new Set(matches.map(({ question }) => question.id));
  const visible = rows.filter(({ question }) => question.id === editingRow || visibleIds.has(question.id));

  useEffect(() => {
    if (focusQuestionId) setFilter(initialFilter);
  }, [focusQuestionId]);

  function changeFilter(next: typeof initialFilter) {
    setFilter(next);
    try { sessionStorage.setItem(filterKey, JSON.stringify(next)); } catch { /* Keep the filter for this view. */ }
  }

  function exportProduct() {
    const ids = new Set(rows.map(({ question }) => question.id));
    const filename = product.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'product';
    downloadBackup({
      products: [product],
      questions: rows.map(({ question }) => question),
      answers: snapshot.answers.filter((answer) => ids.has(answer.question_id)),
    }, `snipcue-${filename}.json`);
  }

  async function removeProduct() {
    if (!window.confirm(`Delete “${product.name}” and all its questions and answers?`)) return;
    await deleteWithUndo(() => deleteProduct(product.id));
  }

  return (
    <div className="stack product-view">
      <header className="stack product-heading">
        <div className="spread product-heading-row">
          {editingName ? (
            <InlineText label="Product name" value={product.name} save={(name) => renameProduct(product.id, name)} idle={false}
              close={(_, restoreFocus) => {
                setEditingName(false);
                if (restoreFocus) requestAnimationFrame(() => nameButton.current?.focus());
              }} />
          ) : (
            <h1 className="product-name">
              <button ref={nameButton} type="button" className="rename-product" onClick={() => setEditingName(true)}>
                {product.name}<span className="name-pencil" aria-hidden="true">✎</span>
              </button>
            </h1>
          )}
          <div className="row product-heading-actions">
            <CopyPrompt product={product} snapshot={snapshot} notify={notify} />
            {!product.feed_url && <button type="button" ref={pasteButton} className="primary" aria-expanded={paste} onClick={() => setPaste(!paste)}>Paste AI answers</button>}
            <MoreActions label="More product actions" actions={[
              { label: 'Rename', onSelect: () => setEditingName(true) },
              { label: 'Feed settings…', onSelect: () => setFeedSettings(true) },
              { label: 'Export this product', onSelect: exportProduct },
              { label: 'Delete product', danger: true, onSelect: () => void removeProduct() },
            ]} />
          </div>
        </div>
        <div className="row product-stats small muted">
          <span>{totals.all} question{totals.all === 1 ? '' : 's'} · {openCount} open</span>
          {product.feed_url && <FeedSummary product={product} notify={notify} />}
        </div>
      </header>
      {feedSettings && <FeedDialog product={product} onClose={() => setFeedSettings(false)} />}
      {paste && !product.feed_url && <PasteAnswers product={product} snapshot={snapshot} notify={notify}
        onClose={() => { setPaste(false); pasteButton.current?.focus(); }} />}
      <section className="stack questions" aria-label="Questions">
        <div className="spread question-toolbar">
          <input type="search" aria-label="Filter questions" placeholder="Filter questions…" value={filter.query}
            onChange={(event) => changeFilter({ ...filter, query: event.target.value })} />
          <div className="segments" role="radiogroup" aria-label="Question status">
            {(['all', 'open', 'answered'] as const).map((mode) => (
              <label key={mode}>
                <input type="radio" className="visually-hidden" name="question-status" value={mode} checked={filter.mode === mode}
                  onChange={() => changeFilter({ ...filter, mode })} />
                <span>{mode[0].toUpperCase() + mode.slice(1)} {totals[mode]}</span>
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setAdding(true)}>Add question</button>
        </div>
        {filter.mode === 'open' && matches.length > 0 && (
          <div>
            <CopyPrompt product={product} notify={notify} label={`Copy AI prompt for these ${matches.length}`}
              snapshot={{ ...snapshot, questions: snapshot.questions.filter((q) => answersByQuestion.has(q.id) || visibleIds.has(q.id)) }} />
          </div>
        )}
        {product.feed_url && <p className="small muted">From feed — edit the source file</p>}
        {adding && <NewQuestion product={product} notify={notify} onClose={() => setAdding(false)} />}
        {!visible.length && !adding && <p className="small muted question-empty">{rows.length ? 'No questions match this filter.' : 'No questions yet.'}</p>}
        {visible.map(({ question, answers }) => (
          <QuestionView key={question.id} question={question} answers={answers} feed={!!product.feed_url} notify={notify}
            focusAnswerId={focusAnswerId} focused={question.id === focusQuestionId}
            deleteWithUndo={deleteWithUndo}
            onEditingChange={(active) => setEditingRow((current) => active ? question.id : current === question.id ? null : current)} />
        ))}
      </section>
    </div>
  );
}

function FeedSummary({ product, notify }: { product: Product; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const { feed } = product;
  return (
    <span className="row feed-summary">
      <span role="status" title={feed?.error}>
        · Feed: {busy ? 'checking…' : feed?.error ? 'check failed' : feed?.synced_at ? `synced ${timeAgo(feed.synced_at, clock)}` : 'waiting to sync'}
      </span>
      <button type="button" className="icon-button" aria-label="Refresh feed" title="Refresh feed" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await refreshProductFeed(product.id, true); } catch (e) { notify((e as Error).message, 'err'); }
        finally { setBusy(false); setClock(Date.now()); }
      }}>↻</button>
    </span>
  );
}

function NewQuestion({ product, notify, onClose }: { product: Product; notify: Notify; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AnswerInput>({ text: '' });
  return (
    <form className="card stack" aria-label="New question" onSubmit={async (event) => {
      event.preventDefault();
      try {
        const added = await createQuestion(product.id, question, !product.feed_url && answer.text.trim() ? answer : undefined);
        if (added) onClose();
        else notify('This question already exists.', 'err');
      } catch (e) {
        notify((e as Error).message, 'err');
      }
    }}>
      <label>
        Question
        <input type="text" value={question} onChange={(event) => setQuestion(event.target.value)} required autoFocus />
      </label>
      {!product.feed_url && <AnswerFields value={answer} onChange={setAnswer} optional />}
      <div className="row">
        <button type="submit" className="primary" disabled={!question.trim()}>Save question</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function QuestionView({ question, answers, feed, notify, focusAnswerId, focused, onEditingChange, deleteWithUndo }: {
  question: Question; answers: Answer[]; feed: boolean; notify: Notify; focusAnswerId?: string; focused: boolean;
  onEditingChange: (active: boolean) => void;
  deleteWithUndo: DeleteWithUndo;
}) {
  const [open, setOpen] = useState(focused);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const article = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const readOnly = feed && !!answers.length;
  const first = answers[0];
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      (document.getElementById(`answer-${focusAnswerId}`) ?? article.current)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focused, focusAnswerId]);

  return (
    <article className="card question" data-open={open} ref={article}>
      <div className="question-header">
        {editing ? (
          <InlineText label="Question" value={question.question} save={(text) => renameQuestion(question.id, text)} close={(changed, restoreFocus) => {
            setSaved(changed);
            setEditing(false);
            onEditingChange(false);
            if (restoreFocus) requestAnimationFrame(() => toggle.current?.focus());
          }} />
        ) : (
          <button type="button" ref={toggle} className="question-toggle" aria-expanded={open}
            aria-controls={`question-${question.id}`} onClick={() => setOpen(!open)}>
            <span className="question-chevron" aria-hidden="true">⌄</span>
            <span className="question-summary">
              <span className="question-line">
                <strong>{question.question}</strong>
                <span className="small muted">{answers.length} {answers.length === 1 ? 'answer' : 'answers'}</span>
                {saved && <SaveStatus text="Saved ✓" />}
              </span>
              {!open && first && <span className="question-preview-row">
                <span className="question-preview muted">{first.text}</span>
                {first.label && <span className="badge">{first.label}</span>}
              </span>}
            </span>
          </button>
        )}
        {!readOnly && <MoreActions label="More question actions" actions={[
          { label: 'Edit question', onSelect: () => { setEditing(true); setSaved(false); onEditingChange(true); } },
          { label: 'Delete question', danger: true, onSelect: () => void deleteWithUndo(() => deleteQuestion(question.id)) },
        ]} />}
      </div>
      <div id={`question-${question.id}`} hidden={!open}>
        {open && (
          <div className="stack question-body">
            {answers.map((answer) => <AnswerView key={answer.id} answer={answer} readOnly={feed}
              deleteWithUndo={deleteWithUndo} onEditingChange={onEditingChange} />)}
            {!answers.length && <p className="small muted">No answer yet.</p>}
            {!feed && (adding
              ? <NewAnswer question={question} notify={notify} onClose={() => setAdding(false)} />
              : <div><button type="button" onClick={() => setAdding(true)}>Add answer</button></div>)}
          </div>
        )}
      </div>
    </article>
  );
}

function NewAnswer({ question, notify, onClose }: { question: Question; notify: Notify; onClose: () => void }) {
  const [value, setValue] = useState<AnswerInput>({ text: '' });
  const [saving, setSaving] = useState(false);
  return (
    <form className="stack answer-block" aria-label="New answer" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      try {
        await createAnswer(question.id, value);
        onClose();
      } catch (e) {
        notify((e as Error).message, 'err');
        setSaving(false);
      }
    }}>
      <AnswerFields value={value} onChange={setValue} focusText />
      <div className="row">
        <button type="submit" className="primary" disabled={saving || !value.text.trim()}>Add</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function AnswerView({ answer, readOnly, deleteWithUndo, onEditingChange }: {
  answer: Answer; readOnly: boolean; deleteWithUndo: DeleteWithUndo; onEditingChange: (active: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  return (
    <div id={`answer-${answer.id}`} className="stack answer-block">
      {editing ? (
        <InlineAnswer value={answer} save={(value) => updateAnswer(answer.id, value)} close={(changed, restoreFocus) => {
          setEditing(false);
          setSaved(changed);
          onEditingChange(false);
          if (restoreFocus) requestAnimationFrame(() => editButton.current?.focus());
        }} />
      ) : (
        <>
          <div className="spread answer-meta">
            <div className="row">
              {answer.label && <span className="badge">{answer.label}</span>}
              {saved && <SaveStatus text="Saved ✓" />}
            </div>
            {!readOnly && <div className="row">
              <button ref={editButton} type="button" className="link" onClick={() => { setEditing(true); setSaved(false); onEditingChange(true); }}>Edit</button>
              <MoreActions label="More answer actions" actions={[{
                label: 'Delete answer', danger: true, onSelect: () => void deleteWithUndo(() => deleteAnswer(answer.id)),
              }]} />
            </div>}
          </div>
          <p className="answer-text">{answer.text}</p>
        </>
      )}
    </div>
  );
}
