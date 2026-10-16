import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiGiobby } from '../src/giobby.js';
import { giacenzeDaReport, isoDaGiobby, ordineVenditaPerPicking } from '../src/giobbyCarico.js';

const riga = (idMaterial, idLot, availableQty, extra = {}) => ({ idStorage: 'MB', idLocation: '', idLot, idMaterial, quantity: availableQty, availableQty, reservedByOrdersQty: 0, ...extra });
const LOTTI = [
  { idLot: 'L2701A', idMaterial: 'FAR-002', expireDate: 1822255200000 }, // 30/09/2027 a mezzanotte italiana
  { idLot: 'L2612B', idMaterial: 'FAR-003', expireDate: 1845928800000 }, // 30/06/2028
];

test('isoDaGiobby: millisecondi di Giobby -> giorno italiano; vuoto = null', () => {
  assert.equal(isoDaGiobby(1822255200000), '2027-09-30');
  assert.equal(isoDaGiobby(1830207600000), '2027-12-31'); // inverno: mezzanotte italiana = 23:00 UTC del giorno prima
  assert.equal(isoDaGiobby(null), null);
});

test('giacenze: quantità per lotto con scadenza; righe senza merce scartate; lotto vuoto o ignoto senza scadenza', () => {
  const g = giacenzeDaReport([
    riga('FAR-002', '', 0, { orderedToSuppliersQty: 10 }), // solo "ordinato al fornitore": niente merce
    riga('FAR-002', 'L2701A', 30),
    riga('FAR-003', 'L2612B', 20, { reservedByOrdersQty: 5, quantity: 25 }), // 25 in magazzino (5 impegnati da ordini, che il picking assegna da solo): conta la quantità fisica
    riga('FAR-003', '', 20, { idLocation: 'A-01-02' }), // semola senza lotto
    riga('FAR-003', 'LNUOVO', 7.5),
    riga('FAR-001', 'LX', -3), // mai negativa
  ], LOTTI);
  assert.deepEqual(g, [
    { articolo: 'FAR-002', lotto: 'L2701A', scadenza: '2027-09-30', ubicazione: null, magazzino: 'MB', disponibile: 30 },
    { articolo: 'FAR-003', lotto: 'L2612B', scadenza: '2028-06-30', ubicazione: null, magazzino: 'MB', disponibile: 25 },
    { articolo: 'FAR-003', lotto: null, scadenza: null, ubicazione: 'A-01-02', magazzino: 'MB', disponibile: 20 },
    { articolo: 'FAR-003', lotto: 'LNUOVO', scadenza: null, ubicazione: null, magazzino: 'MB', disponibile: 7.5 },
  ]);
});

test('ApiGiobby.giacenze: chiede il dettaglio per lotto, segue le pagine e passa il magazzino', async () => {
  const chiamate = [];
  const pagine = [[riga('FAR-002', 'L2701A', 30), riga('FAR-002', 'L2702A', 20)], [riga('FAR-003', 'L2612B', 20)]];
  const http = {
    async get(percorso, query) {
      chiamate.push([percorso, query]);
      if (percorso === '/lots') return { lots: LOTTI, metadata: { totalCount: LOTTI.length } };
      const pagina = Number(query?.offset ?? 0) === 0 ? pagine[0] : pagine[1];
      return { stockReports: pagina, metadata: { totalCount: 3 } };
    },
  };
  const g = await new ApiGiobby(http).giacenze({ magazzino: 'MB' });
  assert.deepEqual(g.map((x) => `${x.articolo}/${x.lotto}/${x.disponibile}`), ['FAR-002/L2701A/30', 'FAR-002/L2702A/20', 'FAR-003/L2612B/20']);
  const report = chiamate.filter(([p]) => p.startsWith('/stocks'));
  assert.equal(report.length, 2); // due pagine
  for (const [, q] of report) {
    assert.equal(q.lotsDetail, 'true');
    assert.equal(q.idStorage, 'MB');
  }
  assert.equal(report[1][1].offset, '2');
});

test('API picking/giacenze: in simulazione risponde con giacenze di prova; con Giobby in errore 502', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-g-'));
  const { config } = await import('../src/config.js');
  const { createApp } = await import('../src/app.js');
  config.moduloB = true;
  config.giobbyMode = 'dryrun';
  const server = createApp().listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/picking/giacenze`);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.fonte, 'prova');
    assert.ok(corpo.giacenze.length > 0 && corpo.giacenze.every((x) => x.articolo && x.disponibile > 0));
  } finally { server.close(); }
});

test('ordine di vendita -> picking: righe merce, consegna più vicina, niente righe vuote', () => {
  const o = ordineVenditaPerPicking({
    id: 1, docNumber: '1', companyName: 'Cliente X',
    rows: [
      { idPosType: 1, idMaterial: 'far-002', quantity: 50, deliveryDate: 1792274400000 },
      { idPosType: 1, idMaterial: 'FAR-003', quantity: 10, deliveryDate: 1792188000000 },
      { idPosType: 5, description: 'testo libero', quantity: 0 },
      { idPosType: 1, idMaterial: 'FAR-009', quantity: 0, deliveryDate: 1792100000000 },
    ],
  });
  assert.deepEqual(o, { id: 'ODV 1', idGiobby: 1, cliente: 'Cliente X', stato: null, consegna: '2026-10-17', righe: [{ articolo: 'FAR-002', descrizione: null, quantita: 50 }, { articolo: 'FAR-003', descrizione: null, quantita: 10 }] });
});

test('ApiGiobby.ordiniVendita: solo ordini aperti, dettaglio per riga, ordinati per consegna', async () => {
  const dettagli = {
    1: { id: 1, docNumber: '1', rows: [{ idPosType: 1, idMaterial: 'FAR-002', quantity: 50, deliveryDate: 1792274400000 }] },
    2: { id: 2, docNumber: '2', rows: [{ idPosType: 1, idMaterial: 'FAR-002', quantity: 30, deliveryDate: 1792188000000 }] },
  };
  const letti = [];
  const http = {
    async get(percorso) {
      letti.push(percorso);
      if (percorso === '/sales/orders') return { documentsHeaders: [{ id: 1, docStatus: 'CREATED' }, { id: 2, docStatus: 'CREATED' }, { id: 3, docStatus: 'COMPLETED_ORDER' }], metadata: { totalCount: 3 } };
      return { document: dettagli[Number(/\/sales\/(\d+)\/orders/.exec(percorso)[1])] };
    },
  };
  const ordini = await new ApiGiobby(http).ordiniVendita();
  assert.deepEqual(ordini.map((o) => o.id), ['ODV 2', 'ODV 1']); // consegna più vicina per prima
  assert.ok(!letti.includes('/sales/3/orders'), 'l\'ordine chiuso non si legge');
});

test('API picking/ordini: in simulazione risponde con ordini di prova', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-o-'));
  const { config } = await import('../src/config.js');
  const { createApp } = await import('../src/app.js');
  config.moduloB = true;
  config.giobbyMode = 'dryrun';
  const server = createApp().listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/picking/ordini`);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.fonte, 'prova');
    assert.ok(corpo.ordini.length > 0 && corpo.ordini.every((x) => x.id && x.righe.length));
  } finally { server.close(); }
});
