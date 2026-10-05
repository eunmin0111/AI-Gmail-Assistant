# MailTask Chrome extension

MailTask reads Gmail messages that match a search, turns likely action requests into editable tasks, and keeps task checkmarks saved in the browser. It includes a compact extension popup and a full dashboard tab. The built-in extractor is deliberately lightweight; the extension remains usable before an LLM is connected.

## Use

Use the popup for a quick list, or open the full dashboard to manage tasks. Select a time range, a Gmail category filter, and optionally add any Gmail search syntax (for example `from:person@example.com`, `label:work`, or `has:attachment`). Gmail combines the fields as one search. Choose a per-run limit (25 by default; 10, 25, 50, or 100). Message details load with four concurrent Gmail requests, and NVIDIA analyzes two emails per model request. Progress appears in the status line. Tasks and completed states are stored with `chrome.storage.local` on this browser profile. Copy list copies a plain-text checklist; Export PDF opens the browser print dialog, where **Save as PDF** is available.

## NVIDIA model connection

The extension calls NVIDIA NIM directly from `extractTasksWithModel()` in `app.js`. For this personal unpacked build, set `NVIDIA_API_KEY` there and keep the extension private. It uses `nvidia/nemotron-3.5-lightning-30b-a3b` and expects the model's answer to contain a JSON array of task objects with a short email reference. If the configured model request fails or returns invalid references, the app displays the error and saves no tasks from that run; it does not silently substitute heuristic guesses. Clearing the key explicitly disables AI and enables the local fallback.

Email content is sent to NVIDIA for inference. If you later share or publish the extension, move the API key and model call behind a backend first.

Gmail API failures now display Google's returned status, reason, and message in the extension instead of hiding the response behind a generic 403. Check that detail before changing OAuth configuration.

## Project map

- `manifest.json`: extension permissions, popup, and OAuth scope/client ID.
- `background.js`: OAuth token request and read-only Gmail API calls.
- `popup.html`: compact filter and generate interface.
- `dashboard.html`: full task dashboard.
- `app.js`: query building, optional model adapter, fallback extraction, and saved task actions.
- `styles.css`: shared responsive layout and print-to-PDF styling.

## Notes

- `manifest.json` is a template until the OAuth client ID is configured.
- The fallback extractor is a best-effort demo heuristic, not an accuracy guarantee. It takes at most one action-like sentence from each email.
- Gmail message content is fetched only after the user starts a run. The search is bounded to the selected limit (at most 100 messages); text body parsing is capped at 12,000 characters per message and each email sent to NVIDIA is capped at 3,500 characters.
- Data is saved locally in Chrome storage. Removing the extension or clearing its data removes the saved list.
