import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { google } from 'googleapis';

const OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(os.homedir(), '.config', 'clawdbot', 'google-oauth.json');
const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH || path.join(os.homedir(), '.config', 'clawdbot', 'google-token.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function hdr(headers, name) {
  const h = (headers || []).find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s)\]}>"']+/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return [...new Set(out)];
}

async function main() {
  if (!fs.existsSync(OAUTH_PATH) || !fs.existsSync(TOKEN_PATH)) {
    console.error('Missing oauth/token. Run gmail-auth.mjs first.');
    process.exit(1);
  }

  const { client_id, client_secret } = readJson(OAUTH_PATH);
  const tokens = readJson(TOKEN_PATH);

  const oAuth2Client = new google.auth.OAuth2({
    clientId: client_id,
    clientSecret: client_secret,
  });
  oAuth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  // Defaults: all unread (user request). Can override via env.
  const q = process.env.GMAIL_QUERY || 'is:unread';
  const max = Number(process.env.GMAIL_MAX || 25);

  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: max });
  const ids = (list.data.messages || []).map((m) => m.id).filter(Boolean);

  const out = [];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Id', 'List-Unsubscribe'],
    });

    const payload = msg.data.payload;
    const snippet = msg.data.snippet || '';
    const urls = extractUrls(snippet);

    out.push({
      id,
      threadId: msg.data.threadId,
      from: hdr(payload?.headers, 'From'),
      subject: hdr(payload?.headers, 'Subject'),
      date: hdr(payload?.headers, 'Date'),
      listId: hdr(payload?.headers, 'List-Id'),
      listUnsubscribe: hdr(payload?.headers, 'List-Unsubscribe'),
      snippet,
      urls,
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${id}`,
    });
  }

  console.log(JSON.stringify({ query: q, count: out.length, messages: out }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
