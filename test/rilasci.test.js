import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rilasci-'));
const express = (await import('express')).default;
const { pickingRouter, rimuoviRilascio } = await import('../src/pickingApi.js');

const app = express();
app.use(express.json());
app.use('/api/picking', pickingRouter());
const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/picking`;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const rilascio = { id: 'ODV 5', idGiobby: 5, cliente: 'Panificio Rossi', provincia: 'BS', consegna: '2026-10-22', righe: [{ articolo: 'FAR-002', descrizione: 'Farina', lotto: 'L1', scadenza: '2027-01-01', quantita: 30 }] };

test('rilascio al magazzino: rilascia, il magazziniere lo vede, segna preparato con nota, ritira', async () => {
  assert.equal((await post('/rilasci', { ordini: [rilascio] })).json.rilasciati, 1);
  let l = (await (await fetch(`${base}/rilasci`)).json()).rilasci;
  assert.equal(l.length, 1);
  assert.equal(l[0].stato, 'rilasciato');
  assert.equal((await post('/rilasci/stato', { id: 'ODV 5', stato: 'preparato', nota: 'mancano 2' })).json.ok, true);
  l = (await (await fetch(`${base}/rilasci`)).json()).rilasci;
  assert.deepEqual([l[0].stato, l[0].nota], ['preparato', 'mancano 2']);
  assert.equal((await post('/rilasci/stato', { id: 'ODV 99', stato: 'preparato' })).status, 404);
  assert.equal((await post('/rilasci/ritira', { id: 'ODV 5' })).json.ok, true);
  assert.equal((await (await fetch(`${base}/rilasci`)).json()).rilasci.length, 0);
});

test('rilascio: dati non validi rifiutati; dopo il DDT il rilascio sparisce', async () => {
  assert.equal((await post('/rilasci', { ordini: [{ ...rilascio, righe: [{ articolo: 'X', quantita: -1 }] }] })).status, 400);
  await post('/rilasci', { ordini: [rilascio] });
  rimuoviRilascio(5);
  assert.equal((await (await fetch(`${base}/rilasci`)).json()).rilasci.length, 0);

});

// ---- Fasi: preparato con quantità → verificato (lucchetto) → ricalcolo degli altri ordini
const appF = express(); appF.use(express.json()); appF.use('/api/picking', pickingRouter());
const srvF = await new Promise((ok) => { const s = appF.listen(0, () => ok(s)); });
const baseF = `http://127.0.0.1:${srvF.address().port}/api/picking`;
const postF = (p, body) => fetch(baseF + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const elenco = async () => (await (await fetch(`${baseF}/rilasci`)).json()).rilasci;

test('preparate: più del richiesto o articolo estraneo rifiutati; verifica blocca; sblocca riapre', async () => {
  const lotti = (await (await fetch(`${baseF}/giacenze`)).json()).giacenze;
  const g = lotti.find((x) => x.lotto && x.disponibile >= 10);
  const base = { articolo: g.articolo, descrizione: 'X', lotto: g.lotto, scadenza: g.scadenza, ubicazione: g.ubicazione };
  await postF('/rilasci', { ordini: [{ id: 'ODV 70', idGiobby: 70, cliente: 'A', consegna: '2026-10-25', righe: [{ ...base, quantita: 5 }] }] });
  assert.equal((await postF('/rilasci/stato', { id: 'ODV 70', stato: 'preparato', preparate: [{ ...base, quantita: 6 }] })).status, 400);
  assert.equal((await postF('/rilasci/stato', { id: 'ODV 70', stato: 'preparato', preparate: [{ articolo: 'ALTRO', quantita: 1 }] })).status, 400);
  assert.equal((await postF('/rilasci/verifica', { id: 'ODV 70' })).status, 409); // non ancora preparato
  assert.equal((await postF('/rilasci/stato', { id: 'ODV 70', stato: 'preparato', preparate: [{ ...base, quantita: 4 }], nota: 'ne ho trovati 4' })).json.ok, true);
  let o = (await elenco()).find((x) => x.id === 'ODV 70');
  assert.deepEqual([o.stato, o.preparate[0].quantita, o.nota], ['preparato', 4, 'ne ho trovati 4']);
  assert.equal((await postF('/rilasci/verifica', { id: 'ODV 70' })).json.ok, true);
  assert.equal((await postF('/rilasci/stato', { id: 'ODV 70', stato: 'rilasciato' })).status, 409); // lucchetto
  assert.equal((await postF('/rilasci/preparate', { id: 'ODV 70', preparate: [{ ...base, quantita: 5 }] })).status, 409);
  assert.equal((await postF('/rilasci/sblocca', { id: 'ODV 70' })).json.ok, true);
  assert.equal((await postF('/rilasci/preparate', { id: 'ODV 70', preparate: [{ ...base, quantita: 5 }] })).json.ok, true);
  await postF('/rilasci/ritira', { id: 'ODV 70' });
});

test('ricalcolo: il lotto preparato in meno sposta il resto sugli ordini ancora da preparare', async () => {
  const lotti = (await (await fetch(`${baseF}/giacenze`)).json()).giacenze;
  const art = [...new Set(lotti.map((x) => x.articolo))].find((a) => lotti.filter((x) => x.articolo === a && x.lotto && x.disponibile > 0 && (!x.scadenza || x.scadenza >= new Date().toISOString().slice(0, 10))).length >= 2);
  const l = lotti.filter((x) => x.articolo === art && x.lotto && x.disponibile > 0 && (!x.scadenza || x.scadenza >= new Date().toISOString().slice(0, 10))).sort((a, b) => String(a.scadenza || '9').localeCompare(String(b.scadenza || '9')));
  const primo = l[0];
  const riga = (q, x = primo) => ({ articolo: art, descrizione: 'X', lotto: x.lotto, scadenza: x.scadenza, ubicazione: x.ubicazione, quantita: q });
  const q1 = primo.disponibile; // il primo ordine prende tutto il primo lotto
  await postF('/rilasci', { ordini: [
    { id: 'ODV 80', idGiobby: 80, cliente: 'A', consegna: '2026-10-20', righe: [riga(q1)] },
    { id: 'ODV 81', idGiobby: 81, cliente: 'B', consegna: '2026-10-21', righe: [riga(1, l[1])] },
  ] });
  // Il magazziniere dell'ODV 80 ne trova 1 in meno nel primo lotto: preparato q1-1
  const r = (await postF('/rilasci/stato', { id: 'ODV 80', stato: 'preparato', preparate: [riga(q1 - 1)] })).json;
  assert.equal(r.ok, true);
  const o81 = (await elenco()).find((x) => x.id === 'ODV 81');
  assert.equal(o81.stato, 'rilasciato');
  assert.equal(o81.righe[0].lotto, primo.lotto); // ora per l'ODV 81 il primo lotto ha 1 pezzo libero (FEFO)
  assert.ok(r.ricalcolati.includes('ODV 81'));
  for (const id of ['ODV 80', 'ODV 81']) await postF('/rilasci/ritira', { id });

});

test.after(() => { server.close(); srvF.close(); });
