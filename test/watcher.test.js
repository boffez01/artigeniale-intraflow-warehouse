import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-w-'));
const { startWatcher } = await import('../src/watcher.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('il watcher aspetta la fine della scrittura (stampante lenta)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  const visti = [];
  const w = startWatcher({
    dir, stabilityThreshold: 800, pollInterval: 100,
    onFile: async (p) => { visti.push(fs.readFileSync(p, 'latin1').slice(-8)); },
  });
  await new Promise((r) => w.on('ready', r));

  // Il "multifunzione" scrive 5 blocchi a 300ms l'uno (1,5 s totali), poi chiude il PDF.
  const f = path.join(dir, 'scan.pdf');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, '%PDF-1.5\n');
  for (let i = 0; i < 5; i++) { fs.writeSync(fd, 'x'.repeat(1000)); await sleep(300); }
  assert.equal(visti.length, 0, 'non deve scattare mentre il file è ancora in scrittura');
  fs.writeSync(fd, '\n%%EOF\n');
  fs.closeSync(fd);

  for (let i = 0; i < 50 && visti.length === 0; i++) await sleep(100);
  await sleep(1500); // nessun secondo evento
  await w.close();
  assert.equal(visti.length, 1);
  assert.match(visti[0], /%%EOF/, 'il file letto deve essere completo');
});
