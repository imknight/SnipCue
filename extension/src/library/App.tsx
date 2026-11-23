import { useEffect, useRef, useState } from 'react';
import { createProduct, createQuestion } from '../core/library';
import { isUuid } from '../core/util';
import { Toasts } from '../ui/components';
import { useLibrary, useToasts } from '../ui/hooks';
import { ThemePicker } from '../ui/ThemePicker';
import { ImportExport } from './ImportExport';
import { ProductView } from './ProductView';

const day = 86_400_000;
const backupDefaults = { lastExportAt: 0, backupReminderDismissedUntil: 0 };

export function App() {
  const { snapshot, error } = useLibrary();
  const { toasts, push } = useToasts();
  const [hash, setHash] = useState(location.hash);
  const [adding, setAdding] = useState(location.hash === '#add');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [capture, setCapture] = useState<{ key: string; text?: string } | null>(null);
  const [backupSettings, setBackupSettings] = useState<typeof backupDefaults | null>(null);
  const newProductButton = useRef<HTMLButtonElement>(null);
  const params = new URLSearchParams(hash.slice(1));
  const captureId = params.get('capture');
  const captureKey = isUuid(captureId) ? `question:${captureId}` : null;
  const waiting = captureKey !== null && capture?.key !== captureKey;
  const selectedText = capture?.key === captureKey ? capture.text : undefined;

  useEffect(() => {
    const update = () => {
      setHash(location.hash);
      setAdding(location.hash === '#add');
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (!captureKey) return;
    void (async () => {
      try {
        const items = await chrome.storage.session.get(captureKey);
        setCapture({ key: captureKey, text: items[captureKey] });
      } catch (e) {
        setCapture({ key: captureKey });
        push((e as Error).message, 'err');
      }
    })();
  }, [captureKey, push]);
  useEffect(() => {
    async function load() {
      setBackupSettings(await chrome.storage.local.get(backupDefaults));
    }
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && (changes.lastExportAt || changes.backupReminderDismissedUntil)) void load();
    }
    void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  function go(next: string) {
    history.replaceState(null, '', next || location.pathname);
    setHash(next);
    setAdding(next === '#add');
    setName('');
  }

  async function finishCapture(productId: string, saved: boolean) {
    await chrome.storage.session.remove(captureKey!);
    await chrome.storage.local.set({ productId });
    go(`#product=${productId}`);
    push(saved ? 'Question saved.' : 'Question is already saved.');
  }

  if (error) return <p className="notice err" role="alert">{error}</p>;
  if (!snapshot) return <p className="muted" style={{ padding: 16 }}>Loading…</p>;

  const answer = snapshot.answers.find((a) => a.id === params.get('answer'));
  const question = snapshot.questions.find((q) => q.id === (answer?.question_id ?? params.get('question')));
  const products = [...snapshot.products].sort((a, b) => a.name.localeCompare(b.name));
  const product = products.find((p) => p.id === (question?.product_id ?? params.get('product')));
  const backup = hash === '#backup';
  const help = hash === '#help';
  const home = !backup && !help && !captureKey && !product;
  const answered = new Set(snapshot.answers.map((a) => a.question_id));
  const counts = new Map(products.map((p) => [p.id, { answered: 0, open: 0 }]));
  for (const q of snapshot.questions) {
    const count = counts.get(q.product_id)!;
    if (answered.has(q.id)) count.answered++;
    else count.open++;
  }
  const showReminder = backupSettings && Date.now() >= backupSettings.backupReminderDismissedUntil
    && (backupSettings.lastExportAt ? Date.now() - backupSettings.lastExportAt > 30 * day : snapshot.answers.length >= 10);

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Library">
        <button type="button" className="brand-link" aria-current={home ? 'page' : undefined} onClick={() => go('')}>SnipCue</button>
        <div className="stack product-list">
          <h2 className="nav-heading muted">Products</h2>
          {products.map((p) => {
            const count = counts.get(p.id)!;
            return (
              <button key={p.id} type="button" className="nav-item product-nav-item"
                aria-current={!captureKey && p.id === product?.id ? 'page' : undefined} onClick={() => go(`#product=${p.id}`)}>
                <span className="nav-product-name">{p.name}</span>
                {p.feed_url && <span title="Feed product" aria-label="Feed product">⟳</span>}
                {count.open > 0 && <span className="open-dot" title={`${count.open} open questions`}>
                  <span aria-hidden="true">•</span><span className="visually-hidden">{count.open} open question{count.open === 1 ? '' : 's'}</span>
                </span>}
                <span className="nav-count small muted">
                  <span aria-hidden="true">{count.answered}</span>
                  <span className="visually-hidden">{count.answered} answered questions</span>
                </span>
              </button>
            );
          })}
          <button type="button" ref={newProductButton} className="nav-item new-product" aria-expanded={adding} onClick={() => setAdding(!adding)}>+ New product</button>
          {adding && <form className="row add-product" onSubmit={async (event) => {
            event.preventDefault();
            if (creating || waiting) return;
            setCreating(true);
            try {
              const p = await createProduct(name, selectedText);
              if (selectedText) await finishCapture(p.id, true);
              else go(`#product=${p.id}`);
            } catch (e) {
              push((e as Error).message, 'err');
            } finally {
              setCreating(false);
            }
          }}>
            <input type="text" aria-label="New product name" placeholder="Product name" value={name}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  setName('');
                  setAdding(false);
                  newProductButton.current?.focus();
                }
              }} required autoFocus />
            <button type="submit" disabled={!name.trim() || waiting || creating}>Add</button>
          </form>}
          <hr />
          <button type="button" className="nav-item" aria-current={backup ? 'page' : undefined} onClick={() => go('#backup')}>Backup &amp; restore</button>
          <button type="button" className="nav-item" aria-current={help ? 'page' : undefined} onClick={() => go('#help')}>Help</button>
        </div>
        <ThemePicker />
      </nav>

      <main className="content stack">
        {showReminder && (home || product) && (
          <aside className="notice backup-reminder" aria-label="Backup reminder">
            <p>{backupSettings.lastExportAt ? 'Your last backup is over 30 days old.' : 'You have answers worth backing up.'} Export a copy to keep them safe.</p>
            <div className="row">
              <button type="button" className="link" onClick={() => go('#backup')}>Back up now</button>
              <button type="button" className="link" onClick={() => void chrome.storage.local.set({ backupReminderDismissedUntil: Date.now() + 7 * day })}>Remind me in 7 days</button>
            </div>
          </aside>
        )}
        {captureKey ? (
          <section className="card stack" aria-label="Save selected question">
            <h1>Save selected question</h1>
            {waiting ? <p>Loading…</p> : selectedText ? (
              <>
                <p className="answer-text">{selectedText}</p>
                {products.length ? (
                  <form className="stack" onSubmit={async (event) => {
                    event.preventDefault();
                    const id = String(new FormData(event.currentTarget).get('product'));
                    try {
                      await finishCapture(id, await createQuestion(id, selectedText));
                    } catch (e) {
                      push((e as Error).message, 'err');
                    }
                  }}>
                    <label>
                      Product
                      <select name="product" defaultValue="" required>
                        <option value="" disabled>Choose a product</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <div><button type="submit" className="primary">Save question</button></div>
                  </form>
                ) : <p>Choose <strong>+ New product</strong> to save this question.</p>}
              </>
            ) : <p>This selection is no longer available.</p>}
            <div><button type="button" onClick={() => {
              void chrome.storage.session.remove(captureKey);
              go('');
            }}>Cancel</button></div>
          </section>
        ) : backup ? (
          <ImportExport snapshot={snapshot} notify={push} lastExportAt={backupSettings?.lastExportAt ?? 0} />
        ) : help ? (
          <Help />
        ) : product ? (
          <ProductView key={product.id} product={product} snapshot={snapshot} notify={push} focusAnswerId={answer?.id}
            focusQuestionId={question?.id} onDeleted={() => go('')} />
        ) : (
          <section className="stack library-home">
            <h1>{products.length ? 'Library' : 'Add a product'}</h1>
            <p className="muted">{products.length ? 'Choose a product to browse its questions and answers.' : 'Save answers you can find and copy while browsing.'}</p>
            {products.length > 0 && <div className="home-products">
              {products.map((p) => {
                const count = counts.get(p.id)!;
                return (
                  <button type="button" key={p.id} className="card home-product" onClick={() => go(`#product=${p.id}`)}>
                    <strong>{p.name}</strong>
                    <span className="small muted">{count.answered} answered{count.open > 0 && ` · ${count.open} open`}{p.feed_url && ' · Feed'}</span>
                  </button>
                );
              })}
            </div>}
          </section>
        )}
      </main>
      <Toasts toasts={toasts} />
    </div>
  );
}

function Help() {
  return (
    <article className="stack help-page">
      <h1>Help</h1>
      <section className="card stack">
        <h2>Build answers with AI</h2>
        <ol>
          <li>Save questions from the side panel or the right-click menu.</li>
          <li>Choose <strong>Copy AI prompt</strong> and paste the prompt into your AI chat.</li>
          <li>Choose <strong>Paste AI answers</strong> and review the reply before saving.</li>
        </ol>
      </section>
      <section className="card stack">
        <h2>Keep answers in a feed</h2>
        <p>Open a product’s <strong>⋯ → Feed settings</strong> to connect a raw HTTPS JSON file. Edit the source file and refresh the feed to update its answers.</p>
      </section>
      <section className="card stack">
        <h2>Open the side panel</h2>
        <p>Click the SnipCue toolbar icon or press <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>. You can change the shortcut in Chrome.</p>
        <div><button type="button" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Open Chrome shortcuts</button></div>
      </section>
    </article>
  );
}
