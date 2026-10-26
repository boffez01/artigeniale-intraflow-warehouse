import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiGiobby } from '../src/giobby.js';
import { righeOrdineSpezzate } from '../src/giobbyCarico.js';

const rigaOrd = (idPos, idMaterial, quantity) => ({ idPos, idMaterial, idPosType: 1, quantity, price: 10, idVat: '22', um: 'KG', idStorage: 'MB', deliveryDate: 1792274400000, docposstatus: 'CREATED' });

test('righe ordine spezzate per lotto: la prima tiene l\'idPos, il resto non prelevato va in una riga a parte', () => {
  const righe = [rigaOrd(1, 'FAR-002', 50), rigaOrd(2, 'FAR-003', 10)];
  const s = righeOrdineSpezzate(righe, [
    { articolo: 'FAR-002', lotto: 'L1', quantita: 30 },
    { articolo: 'FAR-002', lotto: 'L2', quantita: 15 },
  ]);
  assert.deepEqual(s.map((r) => [r.idPos ?? null, r.idMaterial, r.quantity]), [[1, 'FAR-002', 30], [null, 'FAR-002', 15], [null, 'FAR-002', 5], [2, 'FAR-003', 10]]);
  assert.throws(() => righeOrdineSpezzate(righe, [{ articolo: 'FAR-003', lotto: 'L9', quantita: 11 }]), /chiede 10/);
});

function fintoGiobby({ statoOrdine = 'CREATED', falliscePutDdt = false } = {}) {
  const log = [];
  let ordine = { id: 1, docDescription: 'ODV N. 1', docStatus: statoOrdine, docStatusDesc: statoOrdine === 'CREATED' ? 'Creato' : 'Merce spedita', rows: [rigaOrd(1, 'FAR-002', 50)] };
  const ddt = { id: 11, docDescription: 'DDT-UM N. 1', rows: [
    { idPos: 1, idPosType: 5, quantity: 0, description: 'Riferimento a ODV N. 1', saleorderref: 1, saleorderposref: 1 },
    { idPos: 2, idPosType: 1, idMaterial: 'FAR-002', quantity: 30, saleorderref: 1, saleorderposref: 1, idStorage: 'MB' },
    { idPos: 3, idPosType: 1, idMaterial: 'FAR-002', quantity: 20, saleorderref: 1, saleorderposref: 2, idStorage: 'MB' },
  ] };
  const http = {
    async get(p) {
      log.push(`GET ${p}`);
      if (p === '/lots') return { lots: [{ idLot: 'L2701A', idMaterial: 'FAR-002', expireDate: 1822255200000 }, { idLot: 'L2702A', idMaterial: 'FAR-002', expireDate: 1824933600000 }, { idLot: 'LVECCHIO', idMaterial: 'FAR-002', expireDate: 1700000000000 }], metadata: { totalCount: 3 } };
      if (p.startsWith('/stocks')) return { stockReports: [{ idStorage: 'MB', idLocation: '', idLot: 'L2701A', idMaterial: 'FAR-002', quantity: 30 }, { idStorage: 'MB', idLocation: '', idLot: 'L2702A', idMaterial: 'FAR-002', quantity: 20 }, { idStorage: 'MB', idLocation: '', idLot: 'LVECCHIO', idMaterial: 'FAR-002', quantity: 9 }], metadata: { totalCount: 3 } };
      return { document: p.endsWith('/orders') ? ordine : ddt };
    },
    async post(p) { log.push(`POST ${p}`); return { idDocument: 11 }; },
    async richiesta(metodo, p, { body } = {}) {
      log.push(`${metodo} ${p}`);
      if (metodo === 'PUT' && p === '/sales/1/orders') ordine = { ...ordine, rows: body.rows.map((r, i) => ({ ...r, idPos: r.idPos ?? 10 + i })) };
      if (metodo === 'PUT' && p === '/sales/11/goodsissue') { if (falliscePutDdt) throw new Error('Giobby non risponde'); log.push(JSON.stringify(body.rows.map((r) => [r.idLot ?? null, r.quantity, r.saleorderref ?? null, r.saleorderposref ?? null]))); }
      return {};
    },
  };
  return { http, log, ordine: () => ordine };
}

test('DDT in uscita: ordine spezzato per lotto, DDT dall\'ordine, lotti per riga con il riferimento all\'ordine', async () => {
  const f = fintoGiobby();
  const esito = await new ApiGiobby(f.http, { magazzino: 'MB', oggi: () => '2026-10-16' }).emettiDdtUscita(1, [
    { articolo: 'FAR-002', lotto: 'L2701A', scadenza: '2027-09-30', quantita: 30 },
    { articolo: 'FAR-002', lotto: 'L2702A', scadenza: '2027-10-31', quantita: 20 },
  ]);
  assert.equal(esito.idDdt, 11);
  const ordineScritti = f.log.filter((l) => /^(PUT|POST|DELETE)/.test(l));
  assert.deepEqual(ordineScritti, ['PUT /sales/1/orders', 'POST /sales/1/orderstogoodsissue', 'PUT /sales/11/goodsissue']);
  const righeDdt = JSON.parse(f.log.find((l) => l.startsWith('[[')));
  assert.deepEqual(righeDdt.filter((r) => r[0]), [['L2701A', 30, 1, 1], ['L2702A', 20, 1, 2]]);
});

test('DDT in uscita: ordine non "Creato" o quantità oltre l\'ordine = errore e nessuna scrittura', async () => {
  const f1 = fintoGiobby({ statoOrdine: 'GOOD_DELIVERY' });
  await assert.rejects(new ApiGiobby(f1.http).emettiDdtUscita(1, [{ articolo: 'FAR-002', lotto: null, quantita: 5 }]), /solo per un ordine "Creato"/);
  const f2 = fintoGiobby();
  await assert.rejects(new ApiGiobby(f2.http).emettiDdtUscita(1, [{ articolo: 'FAR-002', lotto: null, quantita: 60 }]), /chiede 50/);
  await assert.rejects(new ApiGiobby(f2.http).emettiDdtUscita(1, [{ articolo: 'FAR-002', lotto: 'L1', quantita: 5 }]), /scadenza/);
  for (const f of [f1, f2]) assert.deepEqual(f.log.filter((l) => /^(PUT|POST|DELETE)/.test(l)), []);
});

test('DDT in uscita: se la scrittura dei lotti fallisce, il DDT si cancella e l\'ordine torna com\'era', async () => {
  const f = fintoGiobby({ falliscePutDdt: true });
  const prima = JSON.stringify(f.ordine().rows);
  await assert.rejects(new ApiGiobby(f.http, { oggi: () => '2026-10-16' }).emettiDdtUscita(1, [
    { articolo: 'FAR-002', lotto: 'L2701A', scadenza: '2027-09-30', quantita: 30 },
    { articolo: 'FAR-002', lotto: 'L2702A', scadenza: '2027-10-31', quantita: 20 },
  ]), /non risponde/);
  assert.ok(f.log.includes('DELETE /sales/11/goodsissue'));
  assert.equal(f.log.filter((l) => l === 'PUT /sales/1/orders').length, 2); // spezzato, poi ripristinato
  assert.deepEqual(f.ordine().rows.map((r) => r.quantity), [50]); // (le righe in più senza idPos non rientrano nel PUT di ripristino)
  assert.equal(JSON.parse(prima).length, 1);
});

const P = (articolo, lotto, quantita, scadenza = '2027-09-30') => ({ articolo, lotto, quantita, scadenza });
const client = (f) => new ApiGiobby(f.http, { magazzino: 'MB', oggi: () => '2026-10-19' });
const scritture = (f) => f.log.filter((l) => /^(PUT|POST|DELETE)/.test(l));

test('paletti DDT in uscita: articolo fuori ordine, quantità non valide, lotto doppio: errore, niente scritto', async () => {
  const f = fintoGiobby();
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-009', 'L2701A', 5)], { parziale: true }), /non è nell'ordine/);
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', 10), P('FAR-002', 'L2701A', 5)], { parziale: true }), /due volte/);
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', -3)], { parziale: true }), /Nessun prelievo/);
  f.ordine().rows[0].um = 'PZ'; // pezzi: niente decimali
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', 2.5)], { parziale: true }), /numero intero/);
  assert.deepEqual(scritture(f), []);
});

test('paletti DDT in uscita: lotto inesistente, scaduto o oltre la giacenza riletta: errore, niente scritto', async () => {
  const f = fintoGiobby();
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'LNONC', 5)], { parziale: true }), /non risulta in magazzino/);
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'LVECCHIO', 5)], { parziale: true }), /scaduto/);
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', 31)], { parziale: true }), /in magazzino ce ne sono 30/);
  assert.deepEqual(scritture(f), []);
});

test('paletti DDT in uscita: meno dell\'ordinato serve la conferma "parziale"; senza, nessuna scrittura', async () => {
  const f = fintoGiobby();
  await assert.rejects(client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', 30)]), /Consegna parziale \(FAR-002 30\/50\)/);
  assert.deepEqual(scritture(f), []);
  const esito = await client(f).emettiDdtUscita(1, [P('FAR-002', 'L2701A', 30)], { parziale: true });
  assert.equal(esito.idDdt, 11);
  assert.ok(scritture(f).includes('POST /sales/1/orderstogoodsissue'));
});

test('unità: pezzi solo interi, kg anche decimali', async () => {
  const { umDecimale } = await import('../src/giobbyCarico.js');
  assert.equal(umDecimale('KG'), true);
  assert.equal(umDecimale('PZ'), false);
  assert.equal(umDecimale(null), true);
});

test('ordine già spedito in parte: le righe consegnate non sono più da evadere né si spezzano', async () => {
  const { ordineVenditaPerPicking, righeOrdineSpezzate } = await import('../src/giobbyCarico.js');
  const doc = { id: 7, docNumber: '7', rows: [
    { idPos: 1, idPosType: 1, idMaterial: 'FAR-002', quantity: 30, docposstatus: 'GOOD_DELIVERY', idLot: 'L1' },
    { idPos: 2, idPosType: 1, idMaterial: 'FAR-002', quantity: 20, docposstatus: 'CREATED' },
    { idPos: 3, idPosType: 1, idMaterial: 'FAR-003', quantity: 10, docposstatus: 'GOOD_PARTIAL_DELIVERY' },
  ] };
  assert.deepEqual(ordineVenditaPerPicking(doc).righe.map((r) => [r.articolo, r.quantita]), [['FAR-002', 20], ['FAR-003', 10]]);
  const out = righeOrdineSpezzate(doc.rows, [{ articolo: 'FAR-002', lotto: 'L2', quantita: 20 }]);
  assert.deepEqual(out.map((r) => [r.quantity, r.docposstatus]), [[30, 'GOOD_DELIVERY'], [20, 'CREATED'], [10, 'GOOD_PARTIAL_DELIVERY']]);
});
