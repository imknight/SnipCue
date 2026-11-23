import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { refreshProductFeed } from '../core/feed';
import { createProduct, createQuestion, recordAnswerCopy } from '../core/library';
import { answerImportPrompt } from '../core/portable';
import { buildIndex, searchAnswers } from '../core/search';
import type { Answer, Product } from '../core/types';
import { questionKey, searchFold } from '../core/util';
import { ManualCopy, Toasts } from '../ui/components';
import { copyText, useLibrary, useToasts } from '../ui/hooks';
import { PasteAnswers } from '../ui/PasteAnswers';
import { ThemePicker } from '../ui/ThemePicker';

const saveResultId = 'save-question';
const savedMessage = "Saved — it'll be in your next AI prompt";

function openLibrary(hash = '') {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`library/library.html${hash}`) });
}

export function App() {
  const { snapshot, error } = useLibrary();
  const { toasts, push, dismiss } = useToasts();
  const [remembered, setRemembered] = useState<string | null>();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<Answer | null>(null);
  const [pasting, setPasting] = useState(false);
  const [creating, setCreating] = useState<'new' | 'save' | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [saving, setSaving] = useState(false);
  const productPicker = useRef<HTMLSelectElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number>();

  useEffect(() => {
    void chrome.storage.local.get({ productId: null, allProducts: false }).then(({ productId, allProducts }) => {
      setRemembered(allProducts ? 'all' : productId);
    });
  }, []);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const products = useMemo(() => [...(snapshot?.products ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [snapshot]);
  const selected = remembered === 'all' ? undefined : products.find((p) => p.id === remembered) ?? products[0];
  const selectedId = selected?.id;
  useEffect(() => {
    if (remembered === null && selectedId) void chrome.storage.local.set({ productId: selectedId });
  }, [remembered, selectedId]);

  const index = useMemo(() => snapshot ? buildIndex(snapshot) : [], [snapshot]);
  const answers = useMemo(() => searchAnswers(index, query, selectedId), [index, query, selectedId]);
  const questions = useMemo(() => (snapshot?.questions ?? []).filter((q) => !selectedId || q.product_id === selectedId), [snapshot, selectedId]);
  const openQuestions = useMemo(() => {
    const answered = new Set(snapshot?.answers.map((a) => a.question_id));
    return questions.filter((q) => !answered.has(q.id));
  }, [questions, snapshot]);
  const queryTerms = searchFold(query).split(/\s+/).filter(Boolean);
  const searching = !!query.trim();
  const openResults = searching ? openQuestions.filter((q) => queryTerms.every((term) => searchFold(q.question).includes(term))) : [];
  const showSave = searching && (!selectedId || !questions.some((q) => questionKey(q.question) === questionKey(query)));
  const count = answers.length + openResults.length;
  const resultIds = [
    ...(showSave && !saving ? [saveResultId] : []),
    ...answers.map(({ answer }) => `copy-${answer.id}`),
    ...openResults.map((q) => `edit-${q.id}`),
  ];
  const tabResult = activeResult && resultIds.includes(activeResult) ? activeResult : resultIds[0];

  function changeQuery(next: string) {
    setQuery(next);
    setActiveResult(null);
    setOpenId(null);
    window.scrollTo(0, 0);
  }

  function selectProduct(productId: string) {
    setRemembered(productId);
    setOpenId(null);
    setActiveResult(null);
    setPasting(false);
    setCreating(null);
    window.scrollTo(0, 0);
    if (productId === 'all') void chrome.storage.local.set({ allProducts: true });
    else void chrome.storage.local.set({ productId, allProducts: false });
  }

  async function addProduct() {
    if (saving) return;
    setSaving(true);
    try {
      const product = await createProduct(newProductName, creating === 'save' ? query : undefined);
      selectProduct(product.id);
      setNewProductName('');
      if (creating === 'save') {
        changeQuery('');
        push(savedMessage);
      }
    } catch (e) {
      push((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestion() {
    if (saving) return;
    if (!selected) {
      if (products.length) productPicker.current?.focus();
      else setCreating('save');
      return;
    }
    setSaving(true);
    try {
      const value = query;
      const saved = await createQuestion(selected.id, value);
      void chrome.storage.local.set({ productId: selected.id });
      setQuery((current) => current === value ? '' : current);
      setActiveResult(null);
      searchBox.current?.focus();
      push(saved ? savedMessage : 'Question is already saved.');
    } catch (e) {
      push((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  async function copyAnswer(answer: Answer) {
    if (!await copyText(answer.text)) {
      setManualCopy(answer);
      return;
    }
    window.clearTimeout(copyTimer.current);
    setCopiedId(answer.id);
    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1500);
    void recordAnswerCopy(answer.id).catch(console.warn);
  }

  function moveResultFocus(direction: 1 | -1, currentId?: string) {
    const current = currentId ? resultIds.indexOf(currentId) : -1;
    const first = count > 0 && resultIds[0] === saveResultId ? 1 : 0;
    const next = current === -1 ? (direction === 1 ? first : resultIds.length - 1) : current + direction;
    if (next < 0) {
      searchBox.current?.focus({ preventScroll: true });
      return;
    }
    const nextId = resultIds[next];
    if (nextId) document.getElementById(nextId)?.focus();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveResultFocus(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      changeQuery('');
    } else if (event.key === 'Enter' && showSave && !count) {
      event.preventDefault();
      void saveQuestion();
    }
  }

  function onResultsKey(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      changeQuery('');
      searchBox.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const primary = (event.target as HTMLElement).closest('li')?.querySelector('[data-result]');
      moveResultFocus(event.key === 'ArrowDown' ? 1 : -1, primary?.id);
    }
  }

  if (error) return <p className="notice err" role="alert">{error}</p>;
  if (!snapshot || remembered === undefined) return <p className="muted" style={{ padding: 12 }}>Loading…</p>;

  return (
    <main className="stack panel">
      <section className="stack panel-controls" aria-label="Product and search">
        <div className="product-switcher">
          <select ref={productPicker} aria-label="Product" value={selectedId ?? (products.length ? 'all' : '')} onChange={(event) => {
            if (event.target.value === 'new') {
              setCreating('new');
              setPasting(false);
            } else {
              selectProduct(event.target.value);
            }
          }}>
            {!products.length && <option value="" disabled>Choose a product</option>}
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="new">+ New product</option>
            {!!products.length && <option value="all">All products</option>}
          </select>
          <ProductActions
            key={`${selectedId ?? ''}:${selected?.feed_url ?? ''}`}
            product={selected}
            openCount={openQuestions.length}
            onCopy={async () => {
              if (!selected) return;
              const copied = await copyText(answerImportPrompt(selected, snapshot));
              push(copied ? 'Prompt copied.' : 'Clipboard access was blocked.', copied ? 'ok' : 'err');
            }}
            onPaste={() => {
              setCreating(null);
              setPasting(true);
            }}
            onLibrary={() => openLibrary(selected ? `#product=${selected.id}` : '')}
          />
        </div>
        {!pasting && !creating && (
          <div className="search-row">
            <span className="search-icon" aria-hidden="true" />
            <input
              ref={searchBox}
              type="search"
              placeholder="Search or save a question…"
              aria-label="Search or save a question"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />
          </div>
        )}
      </section>

      {manualCopy && (
        <ManualCopy text={manualCopy.text} onCopy={() => void recordAnswerCopy(manualCopy.id).catch(console.warn)} onDone={() => {
          document.getElementById(`copy-${manualCopy.id}`)?.focus();
          setManualCopy(null);
        }} />
      )}

      {creating ? (
        <form className="card stack" aria-label="New product" onSubmit={(event) => {
          event.preventDefault();
          void addProduct();
        }}>
          {creating === 'save' && <p className="answer-text">Create a product to save “{query.trim()}”.</p>}
          <label>
            Product name
            <input name="name" type="text" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} required autoFocus />
          </label>
          <div className="row">
            <button type="submit" disabled={saving}>Add product</button>
            <button type="button" onClick={() => setCreating(null)}>Cancel</button>
          </div>
        </form>
      ) : pasting && selected ? (
        selected.feed_url ? (
          <div className="card stack">
            <p>Edit the source file with your AI, then refresh the feed.</p>
            <div><button type="button" onClick={() => setPasting(false)} autoFocus>Done</button></div>
          </div>
        ) : <PasteAnswers product={selected} snapshot={snapshot} notify={push} onClose={() => setPasting(false)} />
      ) : (
        <section aria-label="Answers" className="answer-list" onKeyDown={onResultsKey}>
          <p className="visually-hidden" role="status">{searching && `${count} ${openResults.length ? 'result' : 'answer'}${count === 1 ? '' : 's'}`}</p>
          {!count && !showSave && <p className="muted small empty-results">{products.length ? 'No answers yet.' : 'Add a product to get started.'}</p>}
          <ul className="results" role="list">
            {showSave && (
              <li>
                <button id={saveResultId} data-result type="button" className="save-result" tabIndex={tabResult === saveResultId ? 0 : -1}
                  onFocus={() => setActiveResult(saveResultId)} disabled={saving} onClick={() => void saveQuestion()}>
                  <span aria-hidden="true">＋</span>{' '}
                  {selected ? <>Save “{query.trim()}” as a question</>
                    : <>{products.length ? 'Choose' : 'Create'} a product to save “{query.trim()}”</>}
                </button>
              </li>
            )}
            {answers.map(({ answer, question, product }) => {
              const open = openId === answer.id;
              const id = `copy-${answer.id}`;
              return (
                <li key={answer.id} className={`answer card${open ? ' open' : ''}`}>
                  <button id={id} data-result type="button" className="answer-head" aria-label={`Copy answer: ${question.question}`}
                    tabIndex={tabResult === id ? 0 : -1} onFocus={() => setActiveResult(id)} onClick={() => void copyAnswer(answer)}>
                    <strong className="answer-q">{question.question}</strong>
                    {answer.label && <span className="badge">{answer.label}</span>}
                    {!open && <span className="answer-text preview-clamp small">{answer.text}</span>}
                    <span id={`answer-${answer.id}`} className="answer-text full" hidden={!open}>{open && answer.text}</span>
                    {copiedId === answer.id && <span className="copy-feedback" aria-hidden="true">Copied ✓</span>}
                  </button>
                  <button type="button" className="answer-toggle" aria-expanded={open}
                    aria-controls={`answer-${answer.id} actions-${answer.id}`} aria-label={open ? 'Hide full answer' : 'Show full answer'}
                    onClick={() => setOpenId(open ? null : answer.id)}>
                    <span aria-hidden="true">⌄</span>
                  </button>
                  <div id={`actions-${answer.id}`} className="answer-actions" hidden={!open}>
                    <button type="button" className="link" onClick={() => openLibrary(`#answer=${answer.id}`)}>{product.feed_url ? 'View' : 'Edit'}</button>
                  </div>
                </li>
              );
            })}
            {openResults.map((q) => {
              const id = `edit-${q.id}`;
              return (
                <li key={q.id} className="card open-question">
                  <strong className="answer-q">{q.question}</strong>
                  <div className="spread">
                    <span className="small muted">No answer yet</span>
                    <button id={id} data-result type="button" className="link" aria-label={`Edit question: ${q.question}`}
                      tabIndex={tabResult === id ? 0 : -1} onFocus={() => setActiveResult(id)}
                      onClick={() => openLibrary(`#question=${q.id}`)}>Edit</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="visually-hidden" role="status">{copiedId && 'Copied to clipboard.'}</p>
      <Toasts toasts={toasts} dismiss={dismiss} />
    </main>
  );
}

function ProductActions({ product, openCount, onCopy, onPaste, onLibrary }: {
  product?: Product;
  openCount: number;
  onCopy: () => Promise<void>;
  onPaste: () => void;
  onLibrary: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now);
  const hasFeed = !!product?.feed_url;
  useEffect(() => {
    if (!hasFeed) return;
    void refresh();
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [hasFeed]);

  async function refresh(force = false) {
    if (!product) return;
    setBusy(true);
    setError('');
    try {
      await refreshProductFeed(product.id, force);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClock(Date.now());
      setBusy(false);
    }
  }

  const feed = product?.feed;
  const failure = error || feed?.error;
  const minutes = Math.max(0, Math.floor((clock - (feed?.synced_at ?? 0)) / 60_000));
  const status = busy ? 'Refreshing…' : failure || (!feed?.synced_at ? 'Waiting to sync'
    : minutes < 1 ? 'Synced just now' : `Synced ${minutes} min ago`);

  return (
    <>
      {hasFeed && (
        <>
          <button type="button" className="control-icon" aria-label="Refresh feed" aria-describedby="feed-status" title={status}
            disabled={busy} onClick={() => void refresh(true)}>↻</button>
          <span className="visually-hidden" id="feed-status" role="status">{status}</span>
        </>
      )}
      <button type="button" className={`control-icon more-trigger${openCount ? ' has-open' : ''}`}
        aria-label={openCount ? `More, ${openCount} open question${openCount === 1 ? '' : 's'}` : 'More'}
        {...{ popovertarget: 'product-actions' }}><span aria-hidden="true">⋯</span></button>
      <div ref={menu} id="product-actions" className="card product-actions" role="group" aria-label="Product actions" {...{ popover: 'auto' }}>
        <button type="button" disabled={!product} onClick={() => {
          menu.current?.hidePopover();
          void onCopy();
        }}>Copy AI prompt{openCount > 0 && <span className="muted"> · {openCount} open</span>}</button>
        <button type="button" disabled={!product} onClick={() => {
          menu.current?.hidePopover();
          onPaste();
        }}>Paste from AI</button>
        <button type="button" onClick={() => {
          menu.current?.hidePopover();
          onLibrary();
        }}>Open library</button>
        {hasFeed && <p className={`small menu-feed-status ${failure && !busy ? 'feed-error' : 'muted'}`}>{status}</p>}
        <ThemePicker />
      </div>
    </>
  );
}
