// Gmail access stays in the extension service worker. The popup and dashboard
// ask for data through messages; OAuth tokens are never stored by this app.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FETCH_GMAIL") return false;

  const report = (text) => {
    chrome.runtime.sendMessage({ type: "MAILTASK_PROGRESS", text }, () => void chrome.runtime.lastError);
  };
  fetchGmailMessages(message.query, message.limit, report)
    .then((messages) => sendResponse({ ok: true, messages }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function fetchGmailMessages(query, limit = 25, report = () => {}) {
  report("Connecting to Gmail…");
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (value) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(value);
    });
  });

  const headers = { Authorization: `Bearer ${token}` };
  const search = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  search.searchParams.set("q", query);
  search.searchParams.set("maxResults", String(Math.min(Math.max(limit, 1), 100)));
  const listing = await fetch(search, { headers });
  if (!listing.ok) throw await describeGmailError(listing, "Gmail search");
  const { messages = [] } = await listing.json();
  report(`Gmail found ${messages.length} matching emails. Reading message details…`);

  // messages.list returns message IDs. Fetch those same message IDs with the
  // message endpoint; do not pass their threadId values to threads.get here.
  const results = new Array(messages.length);
  let nextIndex = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= messages.length) return;
      const { id } = messages[index];
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
        { headers }
      );
      if (!response.ok) {
        const detail = await describeGmailError(response, "Gmail message fetch");
        throw new Error(`${detail.message} Message ID: ${id}.`);
      }
      results[index] = normalizeMessage(await response.json());
      completed += 1;
      report(`Reading Gmail messages… ${completed} of ${messages.length}`);
    }
  };

  // Keep the request count controlled. A 100-request burst can trigger Gmail
  // throttling and made broad date/star searches look like a stalled app.
  await Promise.all(Array.from({ length: Math.min(4, messages.length) }, worker));
  return results;
}

// Preserve Google's structured error so the popup/dashboard can explain the
// actual reason (for example insufficientPermissions or userRateLimitExceeded).
async function describeGmailError(response, operation) {
  let payload = {};
  try { payload = await response.json(); } catch { /* response may not be JSON */ }
  const apiError = payload.error ?? {};
  const reasons = (apiError.errors ?? []).map((item) => item.reason).filter(Boolean);
  const reason = reasons.length ? ` [${[...new Set(reasons)].join(", ")}]` : "";
  const message = apiError.message || response.statusText || "No details returned by Google.";
  return new Error(`${operation} failed (${response.status})${reason}: ${message}`);
}

function normalizeMessage(message) {
  const headers = message.payload?.headers ?? [];
  const header = (name) => headers.find((item) => item.name.toLowerCase() === name)?.value ?? "";
  return {
    id: message.id,
    threadId: message.threadId,
    from: header("from"),
    subject: header("subject") || "(no subject)",
    date: header("date"),
    snippet: message.snippet ?? "",
    body: readBody(message.payload)
  };
}

function readBody(part) {
  const plain = findMimeBody(part, "text/plain");
  if (plain) return decodeBase64Url(plain);
  const html = findMimeBody(part, "text/html");
  return html ? htmlToText(decodeBase64Url(html)) : "";
}

function findMimeBody(part, mimeType) {
  if (!part) return "";
  if (part.mimeType === mimeType && part.body?.data) return part.body.data;
  for (const child of part.parts ?? []) {
    const value = findMimeBody(child, mimeType);
    if (value) return value;
  }
  return "";
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => {
      const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function decodeBase64Url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes).slice(0, 12000);
}
