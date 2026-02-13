import { execFileSync } from 'node:child_process';

// Pull unread mail metadata (ids, from, subject, snippet, urls)
const raw = execFileSync('node', ['gmail-inbox.mjs'], {
  cwd: new URL('.', import.meta.url).pathname,
  env: {
    ...process.env,
    // Start simple: all unread. You can narrow later to newsletters.
    GMAIL_QUERY: process.env.GMAIL_QUERY || 'is:unread',
    GMAIL_MAX: process.env.GMAIL_MAX || '50',
  },
  encoding: 'utf8',
});

const data = JSON.parse(raw);

function normFrom(from) {
  if (!from) return '';
  // try to pull email address
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

// Heuristic: newsletters often have List-Id or List-Unsubscribe headers
function isLikelyNewsletter(m) {
  return Boolean((m.listId && m.listId.length) || (m.listUnsubscribe && m.listUnsubscribe.length));
}

const msgs = (data.messages || []).map((m) => ({ ...m, fromEmail: normFrom(m.from) }));
const newsletters = msgs.filter(isLikelyNewsletter);

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

const groups = groupBy(newsletters.length ? newsletters : msgs, (m) => m.fromEmail || m.from || 'Unknown');

// Output a markdown-ish text block suitable for Telegram.
let out = '';
out += `\n📰 Newsletter Digest (Unread)\n`;
out += `Query: ${data.query}\n`;
out += `Found: ${data.count} unread • Newsletter-likely: ${newsletters.length}\n\n`;

for (const [from, items] of groups.entries()) {
  out += `From: ${from} (${items.length})\n`;
  for (const m of items.slice(0, 8)) {
    out += `- ${m.subject || '(no subject)'}\n`;
    if (m.snippet) out += `  ${m.snippet}\n`;
    out += `  ${m.gmailUrl}\n`;
    if (m.urls && m.urls.length) {
      out += `  Links: ${m.urls.slice(0, 3).join(' ')}\n`;
    }
  }
  if (items.length > 8) out += `  (+${items.length - 8} more)\n`;
  out += `\n`;
}

console.log(out.trim() + '\n');
