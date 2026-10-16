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
    async get(p) { log.push(`GET ${p}`); return { document: p.endsWith('/orders') ? ordine : ddt }; },
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
