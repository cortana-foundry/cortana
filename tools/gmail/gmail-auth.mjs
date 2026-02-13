import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { google } from 'googleapis';

const OAUTH_PATH = process.env.GMAIL_OAUTH_PATH || path.join(os.homedir(), '.config', 'clawdbot', 'google-oauth.json');
const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH || path.join(os.homedir(), '.config', 'clawdbot', 'google-token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

async function main() {
  if (!fs.existsSync(OAUTH_PATH)) {
    console.error(`Missing oauth file: ${OAUTH_PATH}`);
    process.exit(1);
  }

  const { client_id, client_secret } = readJson(OAUTH_PATH);

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oAuth2Client = new google.auth.OAuth2({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUri,
  });

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('Open this URL in your browser and approve access:');
  console.log(authUrl);
  console.log('\nWaiting for OAuth callback...');

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      try {
        const reqUrl = new url.URL(req.url ?? '/', redirectUri);
        if (reqUrl.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const c = reqUrl.searchParams.get('code');
        const err = reqUrl.searchParams.get('error');
        if (err) {
          res.writeHead(400);
          res.end(`OAuth error: ${err}`);
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!c) {
          res.writeHead(400);
          res.end('Missing code');
          reject(new Error('Missing code'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('✅ Gmail OAuth complete. You can close this tab.');
        resolve(c);
      } catch (e) {
        reject(e);
      }
    });
  });

  server.close();

  const { tokens } = await oAuth2Client.getToken(code);
  writeJson(TOKEN_PATH, tokens);

  console.log(`\nSaved token to: ${TOKEN_PATH}`);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
