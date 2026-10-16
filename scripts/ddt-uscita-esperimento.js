// Esperimento DDT di uscita con i lotti scelti dal picking (sandbox).
//   node scripts/ddt-uscita-esperimento.js           -> SIMULAZIONE (POST /sales/goodsissue?simulation=true): non salva niente
//   node scripts/ddt-uscita-esperimento.js --vero    -> crea davvero il DDT; poi guarda con: node scripts/ddt-uscita-stato.js <id>
// Usa l'ordine di vendita 1 (deve essere di nuovo "Creato").
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { dataGiobby, oggiIso } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

if (!/^sb-/i.test(config.giobbyCid || '')) { console.error('✖ Non è un sandbox (cid "sb-..."): mi fermo.'); process.exit(1); }
const vero = process.argv.includes('--vero');
const ID_ORDINE = '1';
const g = new GiobbyHttp();
await g.login();
const giobby = new ApiGiobby(g);

const { document: ordine } = await g.get(`/sales/${ID_ORDINE}/orders`);
console.log(`Ordine ${ordine.docDescription}: stato ${ordine.docStatusDesc} (${ordine.docStatus})`);
if (ordine.docStatus !== 'CREATED') { console.error('✖ L\'ordine non è "Creato": prima ripristina con  node scripts/ddt-uscita-stato.js --cancella'); process.exit(1); }

// Picking: lotti scelti dal programma (FEFO) per QUESTO ordine, con la giacenza fisica per lotto.
const giacenze = (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto);
const ordiniApp = (await giobby.ordiniVendita()).filter((o) => o.idGiobby === ordine.id);
const piano = pianificaPicking({ ordini: ordiniApp.map((o) => ({ id: o.id, consegna: o.consegna, righe: o.righe })), giacenze });
const prelievi = piano.ordini[0].prelievi;
console.log('Lotti scelti dal picking:');
for (const p of prelievi) console.log(`  ${p.articolo} lotto ${p.lotto} q.tà ${p.quantita}`);
if (piano.ordini[0].mancanti.length) { console.error('✖ Merce mancante: non creo il DDT.', JSON.stringify(piano.ordini[0].mancanti)); process.exit(1); }

const posDi = new Map(ordine.rows.filter((r) => r.idPosType === 1).map((r) => [String(r.idMaterial).toUpperCase(), r]));
const corpo = {
  idDocumentType: 1, idDocumentTypeExt: '0', idCustomer: ordine.idCustomer, idContact: String(ordine.idContact),
  docDate: String(dataGiobby(oggiIso())), docCurrency: 'EUR', idBu: ordine.idBu, idNumerator: '1',
  note: '', internalNote: `PROVA PICKING ${ordine.docNumber}`,
  rows: [
    { idPosType: '5', description: `Riferimento a ${ordine.docDescription}`, quantity: '0', price: '0', saleorderref: String(ordine.id), saleorderposref: '1' },
    ...prelievi.map((p) => {
      const r = posDi.get(p.articolo);
      return {
        idMaterial: p.articolo, idPosType: '1', quantity: String(p.quantita), price: String(r.price), idVat: String(r.idVat),
        description: r.description || p.articolo, idStorage: 'MB', idLot: p.lotto,
        saleorderref: String(ordine.id), saleorderposref: String(r.idPos),
      };
    }),
  ],
};
console.log(`\nPOST /sales/goodsissue${vero ? '' : '?simulation=true'}  (${corpo.rows.length} righe)`);
try {
  const r = await g.richiesta('POST', `/sales/goodsissue${vero ? '' : '?simulation=true'}`, { body: corpo });
  const doc = r.document;
  console.log(JSON.stringify(doc ? { id: doc.id, tipo: doc.docTypeDesc, totale: doc.totalAmount, righe: doc.rows.map((x) => ({ idPos: x.idPos, tipo: x.idPosType, articolo: x.idMaterial, q: x.quantity, lotto: x.idLot, rifOrdine: `${x.saleorderref}/${x.saleorderposref}` })) } : r, null, 2));
  if (vero) console.log('\nFatto. Ora guarda cosa è successo: node scripts/ddt-uscita-stato.js <id del DDT>  (id nella risposta sopra: idDocument)');
} catch (e) {
  console.log(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.log(JSON.stringify(e.dettaglio, null, 2).slice(0, 1500));
}
