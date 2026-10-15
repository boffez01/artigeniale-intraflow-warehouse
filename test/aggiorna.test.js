import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const D1 = iso(200), DDT_DATA = iso(-4);

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-agg-'));
process.env.GIOBBY_MODE = 'dryrun'; // i test non toccano mai Giobby, qualunque cosa ci sia nel .env
const { config } = await import('../src/config.js');
const { extractor } = await import('../src/extractor.js');
const { createApp } = await import('../src/app.js');
const { DdtSchema } = await import('../src/schemas.js');
const db = await import('../src/db.js');

const mockDdt = (numero) => DdtSchema.parse({
  fornitore: 'Forn Srl', partita_iva_fornitore: '01234567890', cliente: 'Artigeniale srl',
  numero_ddt: numero, data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
  righe: [{ codice_articolo: 'A1', descrizione: 'Pasta', quantita: 10, unita_misura: 'PZ', lotto: 'L42', data_scadenza: D1 }],
});
let prossimo = '900';
extractor.extractDdt = async () => [mockDdt(prossimo)];
const pdf = (tag) => new Blob([`%PDF-1.4\n${tag}\n%%EOF\n`], { type: 'application/pdf' });
const corpo = (numero, quantita = '10', over = {}) => ({
  fornitore: 'Forn Srl', partita_iva_fornitore: '01234567890', numero_ddt: numero, data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
  righe: [{ codice_articolo: 'A1', descrizione: 'Pasta', quantita, unita_misura: 'PZ', lotto: 'L42', data_scadenza: D1 }], ...over,
});

test('API: un DDT caricato si corregge e la modifica parte verso Giobby; gli altri stati no', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (url, method, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const upload = async (blob, name) => {
    const fd = new FormData(); fd.append('file', blob, name);
    return (await fetch(`${base}/api/upload`, { method: 'POST', body: fd })).json();
  };

  const { id } = await upload(pdf('A'), 'a.pdf');
  // non ancora caricato: l'aggiornamento è rifiutato
  assert.equal((await json(`/api/ddt/${id}/aggiorna`, 'POST', corpo('900'))).status, 409);

  const inviato = await json(`/api/ddt/${id}/invia`, 'POST', corpo('900'));
  assert.equal(inviato.status, 200);
  assert.equal(inviato.body.status, 'caricato');
  assert.equal(inviato.body.modificabile, true, 'caricato = si può correggere');
  const rif = inviato.body.giobby_ref;

  // correzione: quantità e numero DDT
  const agg = await json(`/api/ddt/${id}/aggiorna`, 'POST', corpo('901', '12'));
  assert.equal(agg.status, 200);
  assert.equal(agg.body.status, 'caricato');
  assert.equal(agg.body.ddt.numero_ddt, '901');
  assert.equal(agg.body.ddt.righe[0].quantita, 12);
  assert.equal(agg.body.giobby_ref, rif);
  assert.ok(fs.readdirSync(config.outboxDir).some((f) => f.includes('.agg-')), 'la versione corretta è stata "inviata" (simulazione)');
  assert.equal(db.get(id).numero_ddt, '901', 'anche l\'archivio ha il nuovo numero');

  // errori di validazione: bloccato, la scheda resta com'era
  const brutto = await json(`/api/ddt/${id}/aggiorna`, 'POST', corpo('901', '1.5', { righe: [{ codice_articolo: 'A1', quantita: '1.5', unita_misura: 'PZ', lotto: 'L42', data_scadenza: D1 }] }));
  assert.equal(brutto.status, 422);
  assert.match(brutto.body.error, /Correggi prima/);
  assert.equal(db.get(id).payload.righe[0].quantita, 12);

  // un altro DDT caricato non può prendere lo stesso numero (stesso fornitore e data)
  prossimo = '950';
  const altro = await upload(pdf('B'), 'b.pdf');
  assert.equal((await json(`/api/ddt/${altro.id}/invia`, 'POST', corpo('950'))).status, 200);
  const doppio = await json(`/api/ddt/${altro.id}/aggiorna`, 'POST', corpo('901'));
  assert.equal(doppio.status, 422);
  assert.match(doppio.body.error, /DUPLICATO/); // il secondo prende il numero del primo
  assert.equal(db.get(altro.id).numero_ddt, '950');
  const inverso = await json(`/api/ddt/${id}/aggiorna`, 'POST', corpo('950')); // il primo prende il numero del secondo
  assert.equal(inverso.status, 422);
  assert.match(inverso.body.error, /già un altro DDT/);
  assert.equal(db.get(id).numero_ddt, '901');
});

test('API residuo: in simulazione non ci sono ordini; DDT non caricato = 409; data non valida = 422', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (url, method, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  prossimo = '960';
  const fd = new FormData(); fd.append('file', pdf('R'), 'r.pdf');
  const { id } = await (await fetch(`${base}/api/upload`, { method: 'POST', body: fd })).json();
  assert.equal((await json(`/api/ddt/${id}/residuo`, 'GET')).status, 409);
  assert.equal((await json(`/api/ddt/${id}/residuo/chiudi`, 'POST', { consegna: iso(10) })).status, 422);

  assert.equal((await json(`/api/ddt/${id}/invia`, 'POST', corpo('960'))).status, 200);
  assert.deepEqual((await json(`/api/ddt/${id}/residuo`, 'GET')).body, { disponibile: false });
  const male = await json(`/api/ddt/${id}/residuo/chiudi`, 'POST', { consegna: '31/12/2030' });
  assert.equal(male.status, 422);
  const passato = await json(`/api/ddt/${id}/residuo/chiudi`, 'POST', { consegna: iso(-3) });
  assert.equal(passato.status, 422);
  assert.match(passato.body.error, /passato/);
  const sim = await json(`/api/ddt/${id}/residuo/chiudi`, 'POST', { consegna: iso(10) });
  assert.equal(sim.status, 502);
  assert.match(sim.body.error, /GIOBBY_MODE=api/);
});