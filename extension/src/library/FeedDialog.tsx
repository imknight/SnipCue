import { useEffect, useRef, useState } from 'react';
import { saveProductFeed } from '../core/feed';
import type { Product } from '../core/types';

const sample = JSON.stringify({
  product: 'Field Notes',
  answers: [{ question: 'Can I work offline?', answers: [{ label: 'Short', text: 'Yes.' }] }],
}, null, 2);

export function FeedDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(product.feed_url ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save(value: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const found = await saveProductFeed(product, value);
      if (found) {
        setMessage(`Found ${found.questions} question${found.questions === 1 ? '' : 's'}, ${found.answers} answer${found.answers === 1 ? '' : 's'}. Feed saved.`);
      } else {
        setUrl('');
        setMessage('Feed removed.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="card feed-dialog" aria-labelledby="feed-title" onClose={onClose} onCancel={(event) => {
      if (busy) event.preventDefault();
    }}>
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        if (url.trim() && !busy) void save(url);
      }}>
        <h2 id="feed-title">Feed settings</h2>
        <label>
          Feed URL
          <input name="feedUrl" type="url" value={url} readOnly={busy} spellCheck={false} autoComplete="off" autoCapitalize="none"
            aria-invalid={!!error} aria-describedby={error ? 'feed-help feed-error' : 'feed-help'} onChange={(event) => {
              setUrl(event.target.value);
              setError('');
              setMessage('');
            }} autoFocus />
        </label>
        <p id="feed-help" className="small muted">Use a raw HTTPS URL from GitHub or Gist.</p>
        <details className="feed-guide">
          <summary>How feeds work</summary>
          <div className="stack small">
            <p>Use the raw JSON file, for example <code>https://raw.githubusercontent.com/user/repo/main/product.json</code>. Public repositories expose their answers. Anyone with a secret gist link can read it.</p>
            <p>A valid feed replaces answered content and keeps your open questions. The product name must match.</p>
            <pre>{sample}</pre>
          </div>
        </details>
        {error && <p id="feed-error" className="notice err" role="alert">{error}</p>}
        {message && <p className="notice feed-message" role="status">{message}</p>}
        <div className="row feed-dialog-actions">
          {product.feed_url && <button type="button" className="danger" disabled={busy} onClick={() => void save('')}>Remove feed</button>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button>
            <button type="submit" className="primary" disabled={busy || !url.trim()}>{busy ? 'Testing…' : 'Test & save'}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
