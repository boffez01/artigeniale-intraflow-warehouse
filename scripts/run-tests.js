// Lancia tutti i test in test/*.test.js, con qualsiasi versione di Node (20, 22...) e su Windows.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const cartella = new URL('../test/', import.meta.url);
const file = fs.readdirSync(cartella).filter((f) => f.endsWith('.test.js')).sort().map((f) => new URL(f, cartella).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const esito = spawnSync(process.execPath, ['--test', ...file], { stdio: 'inherit', env: { ...process.env, AUTH: 'off' } });
process.exit(esito.status ?? 1);