# SnipCue

SnipCue is a Chrome extension for saving reusable product answers from an AI chat and finding them while you browse. The library groups answers by product and question. Each answer can have a short label such as “Brief” or “中文”.

## Build and load

Requires Node 20+.

```sh
npm install
npm run build
```

Open `chrome://extensions`, turn on Developer mode, and load `extension/dist` as an unpacked extension. The development build uses the public key in `extension/dev-key.json` to keep its extension ID stable.

## Use

1. Add a product by name. Type in **Search or save a question…** to find answers or save a new question. You can also select text on a page and choose **Save as question in SnipCue**.
2. Select **Copy AI prompt** and paste it into your product chat. The prompt puts your open questions first and tells the chat to skip questions that already have answers.
3. Select **Paste AI answers**, paste the reply, and review the proposed answers. Save the ones you want. A matching answer batch fills the original open question.
4. Open the side panel with the SnipCue toolbar button or **Alt+Shift+S**. Pick a product at the top, or choose **+ New product**. Search the selected product or choose **All products**. Click an answer card to copy it, or use its chevron to expand it.
5. Open **⋯** to see how many questions are open, copy the AI prompt, paste from AI, or open the library.

See the [AI reply format](docs/answer-import-format.md).

## Product feeds

In the library, open a product’s **⋯ → Feed settings…**, enter a direct HTTPS raw GitHub or Gist URL, and choose **Test & save**. The file uses the AI reply format. A successful refresh replaces the product’s answered content and keeps questions you saved while they were open. Use **Copy AI prompt** to ask your AI to edit the source file, then publish the updated file and select **↻** in the side panel.

SnipCue checks a feed when you open the side panel or switch to its product, at most once every five minutes. **↻** checks immediately. Feeds require a CORS-enabled host and no additional Chrome permissions. Public repositories expose their answers to anyone. Private repositories and authentication tokens are unsupported. See the [feed format and hosting details](docs/feed-format.md).

## Backup

Export your library from **Backup & restore** to download a JSON file. Import a schema version 2 backup to preview how many products, questions, and answers will be added. SnipCue matches products by name. It matches questions after trimming, collapsing whitespace, and ignoring case, and skips identical answer text under a matching question.

The prototype’s IndexedDB upgrade starts a fresh library and replaces schema version 1. Schema version 2 backups use the new product, question, and answer model.

Backups include feed URLs and the last saved answers. A restored product checks its feed the next time you open it in the side panel. If a product name already exists, import keeps its current settings. Existing feed products keep their mirrored answers.

## Verify

```sh
npm run typecheck
npm test
npm run test:browser -w extension
npm run build:store -w extension
```

The browser smoke test loads the unpacked extension in isolated Chrome profiles. It writes light and dark screenshots to the directory printed at the end. Set `CHROME_PATH` if Chrome is installed elsewhere.

The store build writes `extension/snipcue-<version>.zip`. See [store listing and permission disclosures](CHROMEWEBSTORE.md).
