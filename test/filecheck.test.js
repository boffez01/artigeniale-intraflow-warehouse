import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileCompleto } from '../src/filecheck.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
const w = (n, c) => { const p = path.join(tmp, n); fs.writeFileSync(p, c); return p; };

test('PDF completo vs troncato vs vuoto', () => {
  assert.equal(fileCompleto(w('ok.pdf', '%PDF-1.5\n...contenuto...\n%%EOF\n')), true);
  assert.equal(fileCompleto(w('meta.pdf', '%PDF-1.5\n' + 'x'.repeat(5000))), false);   // scritto a metà
  assert.equal(fileCompleto(w('vuoto.pdf', '')), false);
  assert.equal(fileCompleto(w('nonpdf.pdf', 'ciao')), false);
  assert.equal(fileCompleto(w('foto.jpg', 'abc')), true);
});
