# Chrome Web Store Listing — SnipCue

Updated 23 November 2026

## Store Listing

**Extension Name**  
SnipCue

**Short Description**  
Save reusable product answers from your AI chat. Search and copy them from the Chrome side panel.

**Detailed Description**

SnipCue keeps the product answers you reuse in a local library. Create a product, copy its AI prompt into your product chat, and paste the chat’s reply into SnipCue. Review the proposed answers and save the ones you want. You can also write answers yourself.

Keep several answers under one question and give them optional labels. Search across question wording, labels, and answer text from the Chrome side panel. Open an answer to copy the full text or edit it in your library.

Save open questions as you browse by typing in the side panel or choosing **Save as question in SnipCue** from the selection menu. The AI prompt puts open questions first.

Switch products at the top of the side panel. You can give a product a raw HTTPS JSON feed to keep its answers in step with a file you maintain.

Your library stays in this Chrome profile. Download a JSON backup to keep a separate copy. SnipCue receives selected text only when you choose its menu item.

**Category**  
Productivity

**Single Purpose**  
Save, find, and copy reusable answers to product questions.

**Primary Language**  
English

## Graphics & Assets

| Asset | Dimensions | Status |
|---|---|---|
| Store icon | 128×128 | Ready in `extension/static/icons/icon-128.png` |
| Side-panel screenshot | 1280×800 | Capture search results and an expanded answer |
| Library screenshot | 1280×800 | Capture a product, its questions, and the AI answer preview |
| Small promo tile | 440×280 | Pending |

Use fictional product data for the store screenshots.

## Permissions Justification

| Permission | Justification |
|---|---|
| `sidePanel` | Opens the searchable answer library beside the page the user is viewing. |
| `storage` | Remembers the last product used in the side panel and temporarily keeps captured questions while the user chooses a product. |
| `unlimitedStorage` | Protects the user’s local library from ordinary storage quota and eviction. |
| `contextMenus` | Saves the user’s selected text as a question only when they choose **Save as question in SnipCue**. |

Product feeds use ordinary CORS requests from the extension pages. They require no additional Chrome permissions.

## Privacy & Data Use

The developer collects no user data. Product names, questions, labels, and answer text stay in the Chrome profile. The user can download a backup or copy selected text. SnipCue receives selected text when the user chooses the save menu item. SnipCue fetches only the feed URLs the user enters. The selected host receives the URL and ordinary request metadata. Feed requests carry no library records, browser cookies, or authentication tokens.

| Data Type | Collected by developer? | Sent off device by SnipCue? |
|---|---|---|
| Personal communications or user-authored content | No. Library records stay local. | No |
| Website content | No | No |
| Web history | No | No |
| Personal, financial, health, authentication, location, or activity data | No | No |

SnipCue does not sell user data or use it for unrelated purposes, creditworthiness, or lending.

## Privacy Policy

Host `docs/PRIVACY.md` publicly and fill in its contact email before submission.

## Distribution

Unlisted for the pilot. All regions.

## Developer Info

- Publisher name pending
- Contact email and support URL pending
- Homepage URL pending

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.1.0 | 2026-11-19 | Initial MVP draft | Draft |
| 0.1.0 | 2026-11-22 | Added AI prompt and pasted-answer review | Draft |
| 0.1.0 | 2026-11-23 | Simplified the library to products, questions, and answers. Added inline AI paste in the side panel. | Draft |

## Packaging

Run `npm run build:store -w extension` to create `extension/snipcue-0.1.0.zip`. The ZIP excludes the development key and source maps.
