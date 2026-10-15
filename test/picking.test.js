import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pianificaPicking } from '../src/picking.js';

const OGGI = '2026-10-12';
const giac = [
  { articolo: 'FAR-002', lotto: 'L-NUOVO', scadenza: '2028-06-30', ubicazione: 'A-01-02', disponibile: 100 },
  { articolo: 'FAR-002', lotto: 'L-VECCHIO', scadenza: '2027-03-31', ubicazione: 'B-02-01', disponibile: 30 },
  { articolo: 'FAR-002', lotto: 'L-SCADUTO', scadenza: '2026-09-30', ubicazione: 'A-01-01', disponibile: 50 },
  { articolo: 'FAR-003', lotto: 'S1', scadenza: '2027-12-31', ubicazione: 'A-01-10', disponibile: 20 },
];

test('FEFO: esce prima il lotto che scade prima, poi si passa al successivo; i lotti scaduti non si toccano', () => {
  const { ordini, scaduti } = pianificaPicking({ ordini: [{ id: 1, righe: [{ articolo: 'far-002', quantita: 50 }] }], giacenze: giac, oggi: OGGI });
  assert.deepEqual(ordini[0].prelievi.map((p) => [p.lotto, p.quantita]), [['L-VECCHIO', 30], ['L-NUOVO', 20]]);
  assert.equal(ordini[0].stato, 'completo');
  assert.deepEqual(scaduti.map((s) => [s.lotto, s.quantita]), [['L-SCADUTO', 50]]);
});

test('merce che non basta: ordine parziale con il dettaglio di cosa manca; nessuna giacenza = non evadibile', () => {
  const { ordini } = pianificaPicking({
    ordini: [{ id: 'A', righe: [{ articolo: 'FAR-003', quantita: 25 }, { articolo: 'FAR-002', quantita: 10 }] }, { id: 'B', righe: [{ articolo: 'XXX', quantita: 5 }] }],
    giacenze: giac, oggi: OGGI,
  });
  assert.equal(ordini[0].stato, 'parziale');
  assert.deepEqual(ordini[0].mancanti, [{ articolo: 'FAR-003', richiesta: 25, prelevata: 20, mancante: 5 }]);
  assert.equal(ordini[1].stato, 'non_evadibile');
});

test('più ordini: si serve prima chi ha la consegna più vicina e la giacenza si consuma', () => {
  const { ordini } = pianificaPicking({
    ordini: [{ id: 'tardi', consegna: '2026-11-01', righe: [{ articolo: 'FAR-003', quantita: 15 }] }, { id: 'presto', consegna: '2026-10-14', righe: [{ articolo: 'FAR-003', quantita: 15 }] }],
    giacenze: giac, oggi: OGGI,
  });
  assert.deepEqual(ordini.map((o) => [o.id, o.stato]), [['presto', 'completo'], ['tardi', 'parziale']]);
  assert.equal(ordini[1].prelievi[0].quantita, 5);
});

test('percorso: ubicazioni in ordine naturale e lo stesso lotto di più ordini si preleva in un colpo solo', () => {
  const { percorso } = pianificaPicking({
    ordini: [{ id: 1, righe: [{ articolo: 'FAR-003', quantita: 5 }, { articolo: 'FAR-002', quantita: 10 }] }, { id: 2, righe: [{ articolo: 'FAR-002', quantita: 5 }] }],
    giacenze: [...giac, { articolo: 'FAR-003', lotto: 'S2', scadenza: '2029-01-01', ubicazione: 'A-01-2', disponibile: 9 }], oggi: OGGI,
  });
  assert.deepEqual(percorso.map((p) => p.ubicazione), ['A-01-10', 'B-02-01']);
  const vecchio = percorso.find((p) => p.ubicazione === 'B-02-01'); // FAR-002: 10 + 5 dallo stesso lotto, un solo prelievo
  assert.equal(vecchio.quantita, 15);
  assert.deepEqual(vecchio.ordini, [{ id: 1, quantita: 10 }, { id: 2, quantita: 5 }]);
  const due = pianificaPicking({ ordini: [{ id: 1, righe: [{ articolo: 'FAR-003', quantita: 25 }] }], giacenze: [...giac, { articolo: 'FAR-003', lotto: 'S2', scadenza: '2029-01-01', ubicazione: 'A-01-2', disponibile: 9 }], oggi: OGGI });
  assert.deepEqual(due.percorso.map((p) => [p.ubicazione, p.quantita]), [['A-01-2', 5], ['A-01-10', 20]], 'A-01-2 viene prima di A-01-10 (ordine naturale)');
});

test('input non valido: errore chiaro, e i dati ricevuti non vengono modificati', () => {
  assert.throws(() => pianificaPicking({ ordini: [{ id: 1, righe: [{ articolo: 'FAR-002', quantita: 0 }] }], giacenze: [] }), /maggiore di zero/);
  const copia = JSON.stringify(giac);
  pianificaPicking({ ordini: [{ id: 1, righe: [{ articolo: 'FAR-002', quantita: 50 }] }], giacenze: giac, oggi: OGGI });
  assert.equal(JSON.stringify(giac), copia);
});

test('interruttore MODULO_B: spento le API del picking rispondono 404, acceso calcolano', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-b-'));
  const { config } = await import('../src/config.js');
  const { createApp } = await import('../src/app.js');
  const chiama = async (acceso) => {
    config.moduloB = acceso;
    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const info = await (await fetch(`${base}/api/info`)).json();
      const r = await fetch(`${base}/api/picking/simula`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordini: [{ id: 1, righe: [{ articolo: 'FAR-003', quantita: 5 }] }], giacenze: giac, oggi: OGGI }),
      });
      return { info, status: r.status, corpo: await r.json() };
    } finally { server.close(); }
  };
  const spento = await chiama(false);
  assert.equal(spento.info.modulo_b, false);
  assert.equal(spento.status, 404);
  const acceso = await chiama(true);
  assert.equal(acceso.info.modulo_b, true);
  assert.equal(acceso.status, 200);
  assert.equal(acceso.corpo.ordini[0].stato, 'completo');
});