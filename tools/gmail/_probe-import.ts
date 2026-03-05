#!/usr/bin/env npx tsx
import db from '../lib/db.ts';

const { withPostgresPath } = db as { withPostgresPath: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv };
console.log('type', typeof withPostgresPath);
