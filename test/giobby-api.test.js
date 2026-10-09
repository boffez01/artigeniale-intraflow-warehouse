import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyError } from '../src/giobbyHttp.js';

const ordine = (extra = {}) => ({ id: 2, docNumber: '2', docDescription: 'ODA N. 2 del 08/10/26', docStatus: 'CREATED', idVendor: '1', vendorData: { vatcode: '01234567897' }, ...extra });
const emDoc = () => ({
  id: 3, docNumber: 'N77/2026', idVendor: '1', idDocumentTypeExt: 0, destIdStorage: '-1', note: '',
  rows: [
    { idPos: 1, idMaterial: null, idPosType: 5, description: 'Riferimento a ODA N. 2', quantity: 0 },
    { idPos: 2, idMaterial: 'FAR-002', idPosType: 1, quantity: 50, price: 1.5, idStorage: 'MB' },
    { idPos: 3, idMaterial: 'FAR-003', idPosType: 1, quantity: 20, price: 4, idStorage: 'MB' },
  ],
});
const ddt = (extra = {}) => ({
  fornitore: 'Farine del Borgo Srl', partita_iva_fornitore: '01234567897', numero_ddt: 'N77/2026', data_ddt: '2026-10-09', numero_ordine_cliente: 'ODA 2',
  righe: [{ codice_articolo: 'FAR-002', quantita: 30, lotto: 'L2610A', data_scadenza: '2027-12-31' }], ...extra,
});

/** Giobby finto: registra le chiamate e risponde come il sandbox. */
function finto({ ordini = [ordine()], em = [], lotto = 'assente', docEm = emDoc() } = {}) {
  const chiamate = [];
  const http = {
    chiamate,
    async get(percorso) {
      chiamate.push(['GET', percorso]);
      if (percorso === '/purchases/orders') return { documentsHeaders: ordini, metadata: { totalCount: ordini.length } };
      if (percorso === '/purchases/goodsreceipt') return { documentsHeaders: em, metadata: { totalCount: em.length } };
      if (percorso.startsWith('/lots/')) {
        if (lotto === 'assente') throw new GiobbyError('Giobby GET: HTTP 404', { status: 404 });
        return { idLot: 'L2610A', idMaterial: lotto };
      }
      if (/goodsreceipt$/.test(percorso)) return { document: docEm };
      throw new Error(`GET inatteso ${percorso}`);
    },
    async post(percorso, body) { chiamate.push(['POST', percorso, body]); return percorso.includes('orderstogoodsreceipt') ? { idDocument: 3 } : {}; },
    async richiesta(metodo, percorso, { body } = {}) { chiamate.push([metodo, percorso, body]); return { responseCode: 200 }; },
  };
  return http;
}
const client = (http) => new ApiGiobby(http, { magazzino: 'MB', oggi: () => '2026-10-09' });

test('carico parziale: EM dall\'ordine, lotto creato, PUT con quantità e lotto del DDT', async () => {
  const http = finto();
  const ref = await client(http).registraCarico(ddt());
  const post = http.chiamate.find((c) => c[1] === '/purchases/2/orderstogoodsreceipt');
  assert.deepEqual(post[2], { idNumerator: '1', docNumber: 'N77/2026', docDate: '1791496800000', idDocumentTypeExt: '0', destIdStorage: 'MB' });
  const lotto = http.chiamate.find((c) => c[1] === '/lots');
  assert.deepEqual(lotto[2], { idLot: 'L2610A', idMaterial: 'FAR-002', incomingDate: 1791496800000, expireDate: 1830207600000, reference: 'Farine del Borgo Srl' });
  const put = http.chiamate.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/purchases/3/goodsreceipt');
  assert.equal(put[2].destIdStorage, 'MB');
  assert.match(put[2].note, /DDT fornitore n\. N77\/2026 del 2026-10-09/);
  const prodotti = put[2].rows.filter((r) => r.idPosType === 1);
  assert.deepEqual(prodotti.map((r) => [r.idMaterial, r.quantity, r.idLot]), [['FAR-002', 30, 'L2610A']]);
  assert.match(ref, /Giobby id 3/);
});

test('lotto già presente per lo stesso articolo: non si ricrea; per un altro articolo: errore', async () => {
  const ok = finto({ lotto: 'FAR-002' });
  await client(ok).registraCarico(ddt());
  assert.ok(!ok.chiamate.some((c) => c[1] === '/lots'));

  const altro = finto({ lotto: 'FAR-009' });
  await assert.rejects(client(altro).registraCarico(ddt()), /altro articolo \(FAR-009\)/);
  assert.ok(altro.chiamate.some((c) => c[0] === 'DELETE'), 'l\'EM creata viene tolta, non resta con le quantità dell\'ordine');
});

test('riprova dopo un tentativo interrotto: EM già in Giobby, non se ne crea un\'altra', async () => {
  const http = finto({ em: [{ id: 3, docNumber: 'N77/2026', idVendor: '1' }] });
  await client(http).registraCarico(ddt());
  assert.ok(!http.chiamate.some((c) => String(c[1]).includes('orderstogoodsreceipt')));
  assert.ok(http.chiamate.some((c) => c[0] === 'PUT'));
  assert.ok(!http.chiamate.some((c) => c[0] === 'DELETE'));
});

test('ordine non trovato, già ricevuto, ambiguo o DDT senza numero d\'ordine: errore chiaro e nessuna scrittura', async () => {
  const scritture = (h) => h.chiamate.filter((c) => c[0] !== 'GET');
  let h = finto({ ordini: [] });
  await assert.rejects(client(h).registraCarico(ddt()), /non trovato/);
  assert.equal(scritture(h).length, 0);

  h = finto({ ordini: [ordine({ docStatus: 'GOOD_RECEIVED', docStatusDesc: 'Merce ricevuta' })] });
  await assert.rejects(client(h).registraCarico(ddt()), /già "Merce ricevuta"/);

  h = finto({ ordini: [ordine(), ordine({ id: 5, docNumber: '02', docDescription: 'ODA N. 02' })] });
  await assert.rejects(client(h).registraCarico(ddt()), /Più ordini/);

  h = finto();
  await assert.rejects(client(h).registraCarico(ddt({ numero_ordine_cliente: null })), /numero d'ordine/);

  h = finto({ ordini: [ordine({ vendorData: { vatcode: '99999999999' } })] });
  await assert.rejects(client(h).registraCarico(ddt()), /non trovato/);
});

test('articolo del DDT assente nell\'ordine: errore (mai un carico parziale in silenzio) e EM creata rimossa', async () => {
  const h = finto();
  await assert.rejects(
    client(h).registraCarico(ddt({ righe: [{ codice_articolo: 'FAR-002', quantita: 30 }, { codice_articolo: 'ZZZ-1', quantita: 1 }] })),
    /ZZZ-1/,
  );
  assert.ok(h.chiamate.some((c) => c[0] === 'DELETE'));
  assert.ok(!h.chiamate.some((c) => c[0] === 'PUT'));
});

test('lotto senza scadenza valida: errore prima di scrivere il PUT', async () => {
  const h = finto();
  await assert.rejects(
    client(h).registraCarico(ddt({ righe: [{ codice_articolo: 'FAR-002', quantita: 30, lotto: 'L9', data_scadenza: null }] })),
    /scadenza mancante/,
  );
  assert.ok(!h.chiamate.some((c) => c[0] === 'PUT'));
});