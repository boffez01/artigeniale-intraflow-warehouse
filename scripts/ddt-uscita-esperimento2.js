// Esperimento 2 (sandbox): DDT di uscita creato DALL'ORDINE e poi corretto con i lotti del picking.
//   node scripts/ddt-uscita-esperimento2.js          -> mostra solo cosa farebbe (non scrive niente)
//   node scripts/ddt-uscita-esperimento2.js --vero   -> lo fa davvero; se la correzione fallisce, cancella il DDT creato
//   --copie=uguali|nessuno|solo-ordine   -> cosa riferire all'ordine nelle righe duplicate (stesso articolo su più lotti)
// Poi guarda l'effetto con:  node scripts/ddt-uscita-stato.js <id>
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { adattaEntrataMerci, corpoPerAggiornamento, dataGiobby, oggiIso } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

if (!/^sb-/i.test(config.giobbyCid || '')) { console.error('✖ Non è un sandbox (cid "sb-..."): mi fermo.'); process.exit(1); }
const vero = process.argv.includes('--vero');
const ID_ORDINE = '1';
const copie = (process.argv.find((a) => a.startsWith('--copie=')) || '--copie=uguali').split('=')[1];
const g = new GiobbyHttp();
await g.login();
const giobby = new ApiGiobby(g);

const { document: ordine } = await g.get(`/sales/${ID_ORDINE}/orders`);
console.log(`Ordine ${ordine.docDescription}: stato ${ordine.docStatusDesc} (${ordine.docStatus})`);
if (ordine.docStatus !== 'CREATED') { console.error('✖ L\'ordine non è "Creato": prima ripristina i DDT di prova con  node scripts/ddt-uscita-stato.js <id> --cancella'); process.exit(1); }

const giacenze = (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto);
const ordiniApp = (await giobby.ordiniVendita()).filter((o) => o.idGiobby === ordine.id);
const piano = pianificaPicking({ ordini: ordiniApp.map((o) => ({ id: o.id, consegna: o.consegna, righe: o.righe })), giacenze });
if (piano.ordini[0].mancanti.length) { console.error('✖ Merce mancante: non creo il DDT.', JSON.stringify(piano.ordini[0].mancanti)); process.exit(1); }
const prelievi = piano.ordini[0].prelievi;
console.log('Lotti scelti dal picking:');
for (const p of prelievi) console.log(`  ${p.articolo} lotto ${p.lotto} q.tà ${p.quantita} (scade ${p.scadenza || '-'})`);
if (!vero) { console.log('\nSolo anteprima. Per farlo davvero: node scripts/ddt-uscita-esperimento2.js --vero'); process.exit(0); }

const r = await g.post(`/sales/${ID_ORDINE}/orderstogoodsissue`, { idNumerator: '1', docDate: String(dataGiobby(oggiIso())), idDocumentTypeExt: '0' });
const id = r.idDocument;
console.log(`\n1) DDT creato dall'ordine: id ${id}`);
try {
  const { document: doc } = await g.get(`/sales/${id}/goodsissue`);
  const ddt = { righe: prelievi.map((p) => ({ codice_articolo: p.articolo, quantita: p.quantita, lotto: p.lotto, data_scadenza: p.scadenza })) };
  const { documento: nuovo, avvisi, nonCaricate } = adattaEntrataMerci(doc, ddt);
  if (nonCaricate.length) throw new Error(`Articoli non nell'ordine: ${nonCaricate.join(', ')}`);
  for (const a of avvisi) console.log(`   avviso: ${a}`);
  const corpo = corpoPerAggiornamento(nuovo);
  // i riferimenti all'ordine (riga per riga) devono restare, altrimenti il DDT si scollega dall'ordine
  const posOriginali = new Set(doc.rows.map((x) => x.idPos));
  corpo.rows.forEach((riga, i) => {
    const o = nuovo.rows[i];
    const copiata = !posOriginali.has(o.idPos); // riga aggiunta per il secondo lotto dello stesso articolo
    if (copiata && copie === 'nessuno') return;
    if (o.saleorderref != null) riga.saleorderref = o.saleorderref;
    if (o.saleorderposref != null && !(copiata && copie === 'solo-ordine')) riga.saleorderposref = o.saleorderposref;
  });
  console.log(`   copie: ${copie}. Righe inviate:`);
  for (const x of corpo.rows) console.log(`     idPos ${x.idPos} tipo ${x.idPosType} ${x.idMaterial ?? ''} q.tà ${x.quantity} lotto ${x.idLot ?? '-'} rif ${x.saleorderref ?? '-'}/${x.saleorderposref ?? '-'}`);
  await g.richiesta('PUT', `/sales/${id}/goodsissue`, { body: corpo });
  console.log('2) DDT corretto con i lotti (PUT riuscito). Righe rilette da Giobby:');
  const { document: dopo } = await g.get(`/sales/${id}/goodsissue`);
  for (const x of dopo.rows) console.log(`     idPos ${x.idPos} tipo ${x.idPosType} ${x.idMaterial ?? ''} q.tà ${x.quantity} lotto ${x.idLot || '-'} rif ${x.saleorderref ?? '-'}/${x.saleorderposref ?? '-'}`);
  console.log(`\nOra guarda cosa è successo:  node scripts/ddt-uscita-stato.js ${id}`);
} catch (e) {
  console.log(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.log(JSON.stringify(e.dettaglio, null, 2).slice(0, 1500));
  try { await g.richiesta('DELETE', `/sales/${id}/goodsissue`); console.log(`DDT ${id} cancellato: sandbox pulito.`); }
  catch (e2) { console.log(`✖ Non sono riuscito a cancellare il DDT ${id}: fallo con  node scripts/ddt-uscita-stato.js ${id} --cancella`); }
}
