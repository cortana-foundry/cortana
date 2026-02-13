#!/usr/bin/env node
// Minimal Home Assistant helper (read-only by default)
// Usage:
//   node ha.mjs status
//   node ha.mjs states [filter]
//   node ha.mjs state <entity_id>
//   node ha.mjs call <domain> <service> '{"entity_id":"switch.x"}'

import fs from 'node:fs';

const cfgPath = process.env.HA_CONFIG || `${process.env.HOME}/.config/clawdbot/homeassistant.json`;
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const baseUrl = cfg.baseUrl.replace(/\/$/, '');
const token = cfg.token;

async function ha(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HA ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'status') {
    console.log(JSON.stringify(await ha('/api/'), null, 2));
  } else if (cmd === 'states') {
    const all = await ha('/api/states');
    const filter = (args[0] || '').toLowerCase();
    const out = filter
      ? all.filter((s) => `${s.entity_id} ${s.attributes?.friendly_name || ''}`.toLowerCase().includes(filter))
      : all;
    console.log(JSON.stringify(out.map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      name: s.attributes?.friendly_name,
    })), null, 2));
  } else if (cmd === 'state') {
    const entity = args[0];
    if (!entity) throw new Error('Missing entity_id');
    console.log(JSON.stringify(await ha(`/api/states/${encodeURIComponent(entity)}`), null, 2));
  } else if (cmd === 'call') {
    const [domain, service, json] = args;
    if (!domain || !service) throw new Error('Usage: call <domain> <service> <jsonPayload>');
    const body = json ? JSON.parse(json) : {};
    console.log(JSON.stringify(await ha(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}` , {
      method: 'POST',
      body: JSON.stringify(body),
    }), null, 2));
  } else {
    console.error('Unknown command. Try: status | states | state | call');
    process.exit(2);
  }
} catch (e) {
  console.error(String(e?.stack || e));
  process.exit(1);
}
