import test from 'node:test';
import assert from 'node:assert/strict';
import { adattaEntrataMerci, dataGiobby } from '../src/giobbyCarico.js';

test('dataGiobby: mezzanotte italiana in millisecondi, uguale a quella salvata da Giobby (inverno ed estate)', () => {
  assert.equal(dataGiobby('2027-12-31'), 1830207600000); // lotto L2610A, creato da Giobby
  assert.equal(dataGiobby('2026-10-09'), 1791496800000); // incomingDate di L2610A (ora legale)
  assert.equal(dataGiobby('2028-06-30'), 1845928800000); // lotto L2610B
  assert.equal(dataGiobby('2027-03-28'), Date.parse('2027-03-27T23:00:00Z'), 'giorno del cambio all’ora legale: la mezzanotte è ancora ora solare');
});

test('dataGiobby: date che non esistono o in formato sbagliato danno null', () => {
  for (const x of ['2027-02-31', '31/12/2027', '', null, undefined, '2027-13-01']) assert.equal(dataGiobby(x), null, String(x));
});

// Entrata Merci reale (EM creata dall'ordine nel sandbox), ridotta ai campi che contano
const em = () => ({
  id: 3, docNumber: 'N77/2026', idVendor: '1',
  rows: [
    { idPos: 1, idMaterial: null, idPosType: 5, description: 'Riferimento a ODA N. 2 del 08/10/26', quantity: 0, auto: true, idLot: null, expiredate: null },
    { idPos: 2, idMaterial: 'FAR-002', idPosType: 1, description: 'Farina di mais 1 kg', quantity: 50, um: 'KG', price: 1.5, idStorage: 'MB', idLot: null, expiredate: null },
    { idPos: 3, idMaterial: 'FAR-003', idPosType: 1, description: 'Semola di grano duro 5 kg', quantity: 20, um: 'KG', price: 4, idStorage: 'MB', idLot: null, expiredate: null },
  ],
});

test('consegna parziale: quantità e lotto dal DDT, l’articolo non consegnato esce, il riferimento resta', () => {
  const originale = em();
  const { documento, avvisi } = adattaEntrataMerci(originale, {
    righe: [{ codice_articolo: 'far-002', quantita: 30, lotto: 'L2610A', data_scadenza: '2027-12-31' }],
  });
  assert.deepEqual(documento.rows.map((r) => r.idPos), [1, 2], 'FAR-003 tolta, riferimento all’ordine al suo posto');
  assert.equal(documento.rows[0].description, 'Riferimento a ODA N. 2 del 08/10/26');
  const far2 = documento.rows[1];
  assert.equal(far2.quantity, 30);
  assert.equal(far2.idLot, 'L2610A');
  assert.equal(far2.expiredate, 1830207600000);
  assert.equal(far2.price, 1.5, 'gli altri campi della riga non si toccano');
  assert.equal(far2.idStorage, 'MB');
  assert.deepEqual(avvisi, ['FAR-003: è nell\'ordine ma non nel DDT, tolto dal carico']);
  assert.deepEqual(originale, em(), 'l’oggetto ricevuto non viene modificato');
});

test('stesso articolo in due lotti: la riga si duplica con un nuovo idPos', () => {
  const { documento, avvisi } = adattaEntrataMerci(em(), {
    righe: [
      { codice_articolo: 'FAR-002', quantita: 20, lotto: 'L1', data_scadenza: '2027-06-30' },
      { codice_articolo: 'FAR-002', quantita: 30, lotto: 'L2', data_scadenza: '2027-09-30' },
      { codice_articolo: 'FAR-003', quantita: 20 },
    ],
  });
  const prodotti = documento.rows.filter((r) => r.idPosType === 1);
  assert.deepEqual(prodotti.map((r) => [r.idMaterial, r.quantity, r.idLot]), [['FAR-002', 20, 'L1'], ['FAR-002', 30, 'L2'], ['FAR-003', 20, null]]);
  assert.equal(new Set(documento.rows.map((r) => r.idPos)).size, documento.rows.length, 'nessun idPos ripetuto');
  assert.equal(prodotti[2].expiredate, null, 'senza lotto non c’è scadenza');
  assert.deepEqual(avvisi, []);
});

test('articolo nel DDT ma non nell’ordine: non viene caricato e si avvisa; lotto con scadenza non valida: avviso', () => {
  const { documento, avvisi } = adattaEntrataMerci(em(), {
    righe: [
      { codice_articolo: 'FAR-002', quantita: 50, lotto: 'LX', data_scadenza: '31/12/2027' },
      { codice_articolo: 'ZZZ-999', quantita: 5 },
      { codice_articolo: 'FAR-003', quantita: 20 },
    ],
  });
  assert.ok(!documento.rows.some((r) => r.idMaterial === 'ZZZ-999'));
  assert.ok(avvisi.some((a) => a.startsWith('ZZZ-999')));
  assert.ok(avvisi.some((a) => /FAR-002: lotto LX senza una scadenza valida/.test(a)));
});

test('corpoPerAggiornamento: solo campi scrivibili, magazzino al posto di -1, righe senza valori calcolati', async () => {
  const { corpoPerAggiornamento } = await import('../src/giobbyCarico.js');
  const c = corpoPerAggiornamento({
    id: 3, docNumber: 'N77/2026', idVendor: '1', destIdStorage: '-1', idDocumentTypeExt: 0, totalAmount: 189.1, vendorData: { a: 1 }, createDate: 1,
    rows: [{ idPos: 2, idMaterial: 'FAR-002', idPosType: 1, quantity: 30, idStorage: 'MB', idLot: 'L1', expiredate: 5, vatCoeff: 22, materialKindOf: 1, note: null }],
  });
  assert.equal(c.destIdStorage, 'MB');
  assert.equal(c.idDocumentTypeExt, '0');
  assert.equal(c.docNumber, 'N77/2026');
  assert.ok(!('totalAmount' in c) && !('vendorData' in c) && !('id' in c));
  assert.deepEqual(c.rows[0], { idPos: 2, idMaterial: 'FAR-002', idPosType: 1, quantity: 30, idStorage: 'MB', idLot: 'L1', expiredate: 5 });
});