import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiGiobby } from '../src/giobby.js';
import { calcolaResiduo, corpoOrdineResiduo, dataGiobby, numeroOrdine, ricevutoPerOrdine } from '../src/giobbyCarico.js';

const riga = (idPos, idMaterial, quantity, extra = {}) => ({
  idPos, idMaterial, idPosType: 1, quantity, price: 1.5, idVat: '22', um: 'KG', idStorage: 'MB', accountCode: '52.301',
  description: `desc ${idMaterial}`, docposstatus: 'GOOD_PARTIAL_RECEIVED', ...extra,
});
const oda6 = (extra = {}) => ({
  id: 6, docNumber: '6', docDescription: 'ODA N. 6 del 12/10/26', docStatus: 'GOOD_PARTIAL_RECEIVED', docStatusDesc: 'Merce parzialmente ricevuta',
  idVendor: '1', idBu: 'U1', idContact: 3, idOrderType: 1, idNumerator: 1, idDocumentType: 2, docDate: 1, createDate: 1000, internalNote: '', note: '',
  vendorData: { vatcode: '01234567897' }, rows: [riga(1, 'FAR-002', 50), riga(2, 'FAR-003', 20)], ...extra,
});
const em8 = () => ({
  id: 8, docNumber: 'FB/2026/0731', idVendor: '1', createDate: 2000,
  rows: [
    { idPos: 1, idPosType: 5, description: 'Riferimento a ODA N. 6 del 12/10/26', quantity: 0 },
    riga(2, 'FAR-002', 30), riga(3, 'FAR-003', 15),
  ],
});
const intestazione = (o) => ({ id: o.id, docNumber: o.docNumber, docDescription: o.docDescription, docStatus: o.docStatus, docStatusDesc: o.docStatusDesc, idVendor: o.idVendor, internalNote: o.internalNote, createDate: o.createDate, vendorData: o.vendorData });
const RIF = 'EM FB/2026/0731 (Giobby id 8, ODA N. 6 del 12/10/26)';

/** Giobby finto con stato: gli ordini creati compaiono nell'elenco e il PUT di chiusura cambia lo stato. */
function finto({ ordini = [oda6()], ems = [em8()], chiusuraFallisce = false } = {}) {
  const chiamate = [];
  const http = {
    chiamate, ordini,
    async get(percorso) {
      chiamate.push(['GET', percorso]);
      if (percorso === '/purchases/orders') return { documentsHeaders: ordini.map(intestazione), metadata: { totalCount: ordini.length } };
      if (percorso === '/purchases/goodsreceipt') return { documentsHeaders: ems.map((e) => ({ id: e.id, idVendor: e.idVendor, createDate: e.createDate })), metadata: { totalCount: ems.length } };
      let m = /^\/purchases\/(\d+)\/orders$/.exec(percorso);
      if (m) return { document: ordini.find((o) => o.id === Number(m[1])) };
      m = /^\/purchases\/(\d+)\/goodsreceipt$/.exec(percorso);
      if (m) return { document: ems.find((e) => e.id === Number(m[1])) };
      throw new Error(`GET inatteso ${percorso}`);
    },
    async post(percorso, body) {
      chiamate.push(['POST', percorso, body]);
      if (percorso === '/purchases/orders') {
        const id = Math.max(...ordini.map((o) => o.id)) + 1;
        ordini.push({ ...oda6(), id, docNumber: String(id), docDescription: `ODA N. ${id} del 15/10/26`, docStatus: 'CREATED', docStatusDesc: 'Creato', internalNote: body.internalNote, createDate: 5000, rows: body.rows });
      }
      return {};
    },
    async richiesta(metodo, percorso, { body } = {}) {
      chiamate.push([metodo, percorso, body]);
      const m = /^\/purchases\/(\d+)\/orders$/.exec(percorso);
      if (metodo === 'PUT' && m) {
        if (chiusuraFallisce) throw new Error('Giobby PUT: HTTP 500');
        Object.assign(ordini.find((o) => o.id === Number(m[1])), { docStatus: body.docStatus, docStatusDesc: 'Ordine evaso' });
      }
      if (metodo === 'DELETE' && m) ordini.splice(ordini.findIndex((o) => o.id === Number(m[1])), 1);
      return { responseCode: 200 };
    },
  };
  return http;
}
const client = (http) => new ApiGiobby(http, { magazzino: 'MB', oggi: () => '2026-10-15' });

test('numeroOrdine: "ODA N. 6 del ...", "ODA 6", "oda n°6"; altro testo = null', () => {
  assert.equal(numeroOrdine('ODA N. 6 del 12/10/26'), '6');
  assert.equal(numeroOrdine('ODA 6'), '6');
  assert.equal(numeroOrdine('oda n°6'), '6');
  assert.equal(numeroOrdine('Riferimento a ODA N. 12'), '12');
  assert.equal(numeroOrdine('fattura 6'), null);
  assert.equal(numeroOrdine(null), null);
});

test('ricevuto per ordine: contano solo le righe sotto il "Riferimento a ODA n" giusto, anche su più EM', () => {
  const due = {
    rows: [
      { idPosType: 5, description: 'Riferimento a ODA N. 6' }, riga(1, 'FAR-002', 10),
      { idPosType: 5, description: 'Riferimento a ODA N. 7' }, riga(2, 'FAR-002', 99),
    ],
  };
  const m = ricevutoPerOrdine([em8(), due], '6');
  assert.equal(m.get('FAR-002'), 40);
  assert.equal(m.get('FAR-003'), 15);
});

test('residuo = ordinato - ricevuto (mai negativo, decimali senza code)', () => {
  const r = calcolaResiduo(oda6(), new Map([['FAR-002', 30], ['FAR-003', 25.5]]));
  assert.deepEqual(r.map((x) => [x.codice, x.ordinato, x.ricevuto, x.residuo]), [['FAR-002', 50, 30, 20], ['FAR-003', 20, 25.5, 0]]);
  const dec = calcolaResiduo({ rows: [riga(1, 'A', 0.3)] }, new Map([['A', 0.1]]));
  assert.equal(dec[0].residuo, 0.2);
});

test('corpo del nuovo ordine: residuo, consegna, "ODA n" nei riferimenti interni, BU; niente numero, lotti, idPos', () => {
  const corpo = corpoOrdineResiduo(oda6(), [{ codice: 'FAR-002', residuo: 20 }, { codice: 'FAR-003', residuo: 5 }], { oggi: '2026-10-15', consegna: '2026-11-05' });
  assert.equal(corpo.docNumber, undefined);
  assert.equal(corpo.idBu, 'U1');
  assert.equal(corpo.internalNote, 'ODA 6');
  assert.equal(corpo.docDate, dataGiobby('2026-10-15'));
  assert.deepEqual(corpo.rows.map((r) => [r.idMaterial, r.quantity, r.deliveryDate, r.accountCode]), [['FAR-002', 20, dataGiobby('2026-11-05'), '52.301'], ['FAR-003', 5, dataGiobby('2026-11-05'), '52.301']]);
  assert.ok(corpo.rows.every((r) => r.idPos === undefined && r.idLot === undefined && r.docposstatus === undefined));
  // solo gli articoli che mancano
  const uno = corpoOrdineResiduo(oda6(), [{ codice: 'FAR-003', residuo: 5 }], { oggi: '2026-10-15', consegna: '2026-11-05' });
  assert.deepEqual(uno.rows.map((r) => r.idMaterial), ['FAR-003']);
});

test('residuoDelCarico: dal riferimento dell\'EM all\'ordine, con quello che manca', async () => {
  const http = finto();
  const info = await client(http).residuoDelCarico(RIF);
  assert.equal(info.ordine.id, 6);
  assert.equal(info.aperto, true);
  assert.equal(info.mancaQualcosa, true);
  assert.deepEqual(info.righe.map((r) => [r.codice, r.ordinato, r.ricevuto, r.residuo]), [['FAR-002', 50, 30, 20], ['FAR-003', 20, 15, 5]]);
  assert.equal(info.successore, null);
  assert.ok(!http.chiamate.some((c) => ['POST', 'PUT', 'DELETE'].includes(c[0])), 'è una lettura: non scrive niente');
  await assert.rejects(client(http).residuoDelCarico('EM senza id'), /Riferimento Giobby mancante/);
});

test('ordine completo: niente residuo', async () => {
  const completo = { ...em8(), rows: [{ idPosType: 5, description: 'Riferimento a ODA N. 6' }, riga(2, 'FAR-002', 50), riga(3, 'FAR-003', 20)] };
  const info = await client(finto({ ems: [completo] })).residuoDelCarico(RIF);
  assert.equal(info.mancaQualcosa, false);
  await assert.rejects(client(finto({ ems: [completo] })).chiudiOrdineConResiduo(RIF, { consegna: '2026-11-05' }), /Non manca niente/);
});

test('chiudi e crea il resto: prima il nuovo ordine, poi la chiusura del vecchio', async () => {
  const http = finto();
  const out = await client(http).chiudiOrdineConResiduo(RIF, { consegna: '2026-11-05' });
  assert.deepEqual([out.chiuso, out.nuovo, out.nuovoId, out.righe], ['ODA N. 6 del 12/10/26', 'ODA N. 7 del 15/10/26', 7, 2]);
  const scritture = http.chiamate.filter((c) => ['POST', 'PUT', 'DELETE'].includes(c[0]));
  assert.deepEqual(scritture.map((c) => `${c[0]} ${c[1]}`), ['POST /purchases/orders', 'PUT /purchases/6/orders']);
  const post = scritture[0][2];
  assert.equal(post.internalNote, 'ODA 6');
  assert.deepEqual(post.rows.map((r) => [r.idMaterial, r.quantity]), [['FAR-002', 20], ['FAR-003', 5]]);
  assert.equal(scritture[1][2].docStatus, 'COMPLETED_ORDER');
  assert.equal(http.ordini.find((o) => o.id === 6).docStatus, 'COMPLETED_ORDER');
});

test('chiusura che fallisce: il nuovo ordine viene tolto, non restano due ordini aperti', async () => {
  const http = finto({ chiusuraFallisce: true });
  await assert.rejects(client(http).chiudiOrdineConResiduo(RIF, { consegna: '2026-11-05' }), /HTTP 500/);
  assert.ok(http.chiamate.some((c) => c[0] === 'DELETE' && c[1] === '/purchases/7/orders'));
  assert.equal(http.ordini.length, 1);
});

test('riprova dopo un tentativo interrotto: se il nuovo ordine esiste già non se ne crea un secondo', async () => {
  const nuovo = oda6({ id: 7, docNumber: '7', docDescription: 'ODA N. 7 del 15/10/26', docStatus: 'CREATED', internalNote: 'ODA 6', createDate: 5000 });
  const http = finto({ ordini: [oda6(), nuovo] });
  const out = await client(http).chiudiOrdineConResiduo(RIF, { consegna: '2026-11-05' });
  assert.equal(out.nuovo, 'ODA N. 7 del 15/10/26');
  assert.ok(!http.chiamate.some((c) => c[0] === 'POST'));
  assert.ok(http.chiamate.some((c) => c[0] === 'PUT' && c[1] === '/purchases/6/orders'));
});

test('ordine già chiuso: non si chiude due volte', async () => {
  const http = finto({ ordini: [oda6({ docStatus: 'COMPLETED_ORDER', docStatusDesc: 'Ordine evaso' })] });
  await assert.rejects(client(http).chiudiOrdineConResiduo(RIF, { consegna: '2026-11-05' }), /già "Ordine evaso"/);
  assert.ok(!http.chiamate.some((c) => ['POST', 'PUT', 'DELETE'].includes(c[0])));
});

test('un DDT che cita l\'ordine chiuso viene agganciato all\'ordine del resto', async () => {
  const chiuso = oda6({ docStatus: 'COMPLETED_ORDER', docStatusDesc: 'Ordine evaso' });
  const nuovo = oda6({ id: 7, docNumber: '7', docDescription: 'ODA N. 7 del 15/10/26', docStatus: 'CREATED', docStatusDesc: 'Creato', internalNote: 'ODA 6', createDate: 5000 });
  const ddt = { numero_ordine_cliente: 'ODA 6', partita_iva_fornitore: '01234567897' };
  assert.equal((await client(finto({ ordini: [chiuso, nuovo] })).trovaOrdine(ddt)).id, 7);
  // senza ordine del resto: errore come prima
  await assert.rejects(client(finto({ ordini: [chiuso] })).trovaOrdine(ddt), /già "Ordine evaso"/);
  // a catena: il nuovo ordine è stato chiuso a sua volta e il resto è in un terzo
  const chiuso7 = { ...nuovo, docStatus: 'COMPLETED_ORDER', docStatusDesc: 'Ordine evaso' };
  const terzo = oda6({ id: 8, docNumber: '8', docDescription: 'ODA N. 8 del 20/10/26', docStatus: 'CREATED', internalNote: 'ODA 7', createDate: 6000 });
  assert.equal((await client(finto({ ordini: [chiuso, chiuso7, terzo] })).trovaOrdine(ddt)).id, 8);
  // un altro fornitore con lo stesso numero di ordine nei riferimenti interni non c'entra
  const altro = oda6({ id: 9, docNumber: '9', idVendor: '2', docStatus: 'CREATED', internalNote: 'ODA 6', vendorData: { vatcode: '99999999999' } });
  await assert.rejects(client(finto({ ordini: [chiuso, altro] })).trovaOrdine(ddt), /già "Ordine evaso"/);
});