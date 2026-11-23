# Product feed format

In the SnipCue library, open the product’s **⋯ → Feed settings…**, enter the direct HTTPS URL of a JSON file, and choose **Test & save**. A public GitHub raw URL looks like `https://raw.githubusercontent.com/<user>/<repo>/main/<product>.json`. You can also use a direct raw URL on `gist.githubusercontent.com` for a secret gist. Choose a branch URL or a gist raw URL without a revision hash if the link should track later edits.

Public repository content is public. Anyone with a secret gist URL can read it. SnipCue makes anonymous requests and supports hosts that allow CORS. Private repositories and authentication tokens are unsupported.

## JSON

The file uses the [same answer fields as AI paste](answer-import-format.md).

```json
{
  "product": "Field Notes",
  "answers": [
    {
      "question": "Can I use Field Notes offline?",
      "answers": [
        { "label": "Short", "text": "Yes. Your notes remain available offline." }
      ]
    }
  ]
}
```

- `product` must match the product name after trimming and ignoring case.
- Each question in `answers` must have at least one answer. Each answer needs `text` and may have a `label`.
- Use an empty top-level `answers` array to clear the product’s feed content.
- The file must be JSON without Markdown fences or commentary. The response body is limited to 2 MB and the request times out after 10 seconds.

## Refresh

The first successful save replaces the product’s answered content. Later refreshes mirror additions, edits, and removals from the source. Invalid files and failed requests keep the current content. Locally saved open questions remain in the library. A matching feed question answers the existing question. If its feed answers are removed, the saved question becomes open again.

Use **Copy AI prompt** to ask your AI to edit the JSON file while keeping its existing entries. After publishing an update, use **↻** for an immediate check. SnipCue also checks when the side panel opens or you switch to the product, at most once every five minutes. Clearing **Feed URL** keeps the most recently saved content as editable local answers.

If a host exposes `ETag` to CORS and allows `If-None-Match` in CORS preflights, SnipCue handles HTTP 304 without replacing content. Other CORS-enabled hosts can use Chrome’s HTTP cache revalidation.
