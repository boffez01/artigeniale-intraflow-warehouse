import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const D1 = iso(200), D2 = iso(260), DDT_DATA = iso(-4);

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-'));
const { config } = await import('../src/config.js');
const { extractor } = await import('../src/extractor.js');
const { createApp } = await import('../src/app.js');
const { DdtSchema } = await import('../src/schemas.js');
const db = await import('../src/db.js');

let numeroDdt = '123';
extractor.extractDdt = async () => // mock di Gemini: nessuna chiamata di rete
  DdtSchema.parse({
    fornitore: 'Forn Srl', partita_iva_fornitore: '01234567890', cliente: 'Artigeniale srl',
    numero_ddt: numeroDdt, data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
    righe: [
      { codice_articolo: 'A1', descrizione: 'Pasta', quantita: 10, unita_misura: 'PZ', lotto: 'L42', data_scadenza: D1 },
      { codice_articolo: 'B2', descrizione: 'Olio', quantita: 5, unita_misura: 'PZ' },
    ],
  });

const pdf = (tag) => new Blob([`%PDF-1.4\n${tag}\n%%EOF\n`], { type: 'application/pdf' });
const outbox = () => fs.readdirSync(config.outboxDir).filter((f) => f.startsWith('DRY-')).length;
const formOk = (numero, over = {}) => new URLSearchParams({
  n_righe: '2', fornitore: 'Forn Srl', partita_iva_fornitore: 'IT01234567890', numero_ddt: numero,
  data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
  r0_codice_articolo: 'A1', r0_quantita: '10', r0_unita_misura: 'PZ', r0_lotto: 'l42', r0_data_scadenza: D1.split('-').reverse().join('/'),
  r1_codice_articolo: 'B2', r1_quantita: '5', r1_unita_misura: 'PZ', r1_lotto: 'L9', r1_data_scadenza: D2,
  azione: 'invia', ...over,
});

test('flusso completo: blocchi, idempotenza, concorrenza', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = async (blob, name) => {
    const fd = new FormData(); fd.append('file', blob, name);
    return fetch(`${base}/upload`, { method: 'POST', body: fd, redirect: 'manual' });
  };
  const post = (id, form) => fetch(`${base}/ddt/${id}/conferma`, { method: 'POST', body: form });
  const page = async (id) => (await fetch(`${base}/ddt/${id}`)).text();

  // 1) Upload: lotto/scadenza mancanti sulla riga 2
  let r = await upload(pdf('A'), 'a.pdf');
  assert.equal(r.headers.get('location'), '/ddt/1');
  let html = await page(1);
  assert.match(html, /Riga 2: lotto mancante/);

  // 2) Richiesta "forzata" con lotto non valido: il server rivalida e BLOCCA
  await post(1, formOk('123', { r0_lotto: 'L 42' }));
  html = await page(1);
  assert.match(html, /non valido/);
  assert.doesNotMatch(html, /Registrato su Giobby/);
  assert.equal(outbox(), 0);

  // 3) Decimale su PZ: bloccato e NON arrotondato
  await post(1, formOk('123', { r1_quantita: '5,5' }));
  assert.match(await page(1), /quantità decimale \(5\.5\)/);
  assert.equal(outbox(), 0);

  // 4) Dati corretti (data italiana, lotto minuscolo, P.IVA con IT): normalizzati e caricati
  await post(1, formOk('123'));
  html = await page(1);
  assert.match(html, /Registrato su Giobby/);
  assert.equal(outbox(), 1);
  const payload = JSON.parse(fs.readFileSync(path.join(config.outboxDir, fs.readdirSync(config.outboxDir).find((f) => f.startsWith('DRY-'))), 'utf8'));
  assert.equal(payload.righe[0].lotto, 'L42');
  assert.equal(payload.righe[0].data_scadenza, D1);
  assert.equal(payload.chiave, `01234567890|123|${DDT_DATA}`);

  // 5) Stessa scansione ricaricata (stessi byte): nessuna nuova riga, rimanda al DDT esistente
  r = await upload(pdf('A'), 'a-bis.pdf');
  assert.equal(r.headers.get('location'), '/ddt/1?dup=1');
  assert.equal(db.listAll().length, 1);

  // 6) Stesso DDT cartaceo ri-scansionato (byte diversi): nuova riga ma BLOCCATA come duplicato
  r = await upload(pdf('B'), 'b.pdf');
  assert.equal(r.headers.get('location'), '/ddt/2');
  assert.match(await page(2), /DUPLICATO.*#1/);
  await post(2, formOk('123'));
  assert.match(await page(2), /DUPLICATO/);
  assert.equal(outbox(), 1, 'nessun secondo carico');
  assert.equal(db.claimInvio(2, `01234567890|123|${DDT_DATA}`), false, "l'indice univoco del DB lo impedisce comunque");

  // 7) Scarto del duplicato
  await fetch(`${base}/ddt/2/scarta`, { method: 'POST', redirect: 'manual' });
  assert.equal(db.get(2).status, 'scartato');

  // 8) Due conferme CONCORRENTI dello stesso DDT: parte un solo carico
  numeroDdt = '124';
  await upload(pdf('C'), 'c.pdf');
  await Promise.all([post(3, formOk('124')), post(3, formOk('124'))]);
  assert.equal(db.get(3).status, 'caricato');
  assert.equal(outbox(), 2, 'esattamente un carico in più, non due');
});
