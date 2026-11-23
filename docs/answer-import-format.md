# SnipCue AI answer format

Select **Copy AI prompt** on a product and paste it into the chat where you discuss that product. The prompt gives the AI the product name, the open questions to answer first, and the answered questions to skip. It asks the AI to use facts from that chat, clarify missing facts, and return only JSON.

```json
{
  "product": "Field Notes",
  "answers": [
    {
      "question": "Can I use Field Notes offline?",
      "answers": [
        { "label": "Short", "text": "Yes. Your notes stay available offline." },
        { "label": "中文", "text": "可以离线查看笔记。" }
      ]
    }
  ]
}
```

The product name must match the selected product. Each question needs at least one answer. The `label` is optional, and `text` is plain text. Search can match a prefix such as “中文” in a question or label.

Select **Paste AI answers** on the product page or **⋯ → Paste from AI** in the side panel. Paste the JSON or a chat reply containing a single JSON block. **Review answers** shows the full text and lets you select which new answers to save. If the reply needs a correction, use **Copy error for AI**.

SnipCue trims question wording and compares it case-insensitively. An exact match adds the selected answers under the existing question. Identical answer text shows **Already saved** and is skipped. The backup format is separate and uses schema version 2.
