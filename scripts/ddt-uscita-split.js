// Esperimento (sandbox): ordine di vendita con la riga FAR-002 SPEZZATA in due (30 + 20), DDT dall'ordine con un lotto per riga.
// Scrive tutto anche in data/esito-ddt-uscita.txt. Alla fine RIPRISTINA l'ordine e cancella il DDT.
//   node scripts/ddt-uscita-split.js
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { adattaEntrataMerci, corpoPerAggiornamento, dataGiobby, oggiIso } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

const FILE = path.join(config.dataDir, 'esito-ddt-uscita.txt');
fs.writeFileSync(FILE, `Esperimento ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };

if (!/^sb-/i.test(config.giobbyCid || '')) { log('✖ Non è un sandbox: mi fermo.'); process.exit(1); }
const ID = '1';
const g = new GiobbyHttp();
await g.login();
const giobby = new ApiGiobby(g);
const leggiOrdine = async () => (await g.get(`/sales/${ID}/orders`)).document;
const righe = (rows) => rows.filter((x) => x.idPosType === 1).map((x) => `[pos ${x.idPos}] ${x.idMaterial} ${x.quantity} ${x.idLot || '-'} rif ${x.saleorderref ?? '-'}/${x.saleorderposref ?? '-'}`).join('; ');

const originale = await leggiOrdine();
log(`Ordine ${originale.docDescription}: ${originale.docStatusDesc}. Righe: ${righe(originale.rows)}`);
if (originale.docStatus !== 'CREATED') { log('✖ L\'ordine non è "Creato": cancella prima i DDT di prova.'); process.exit(1); }

const corpoOrdine = (ordine, rows) => {
  const c = corpoPerAggiornamento(ordine);
  c.rows = rows.map((r) => { const x = {}; for (const k of ['idPos', 'idMaterial', 'idPosType', 'price', 'quantity', 'dsc1', 'dsc2', 'dsc3', 'dsc4', 'idVat', 'description', 'um', 'idStorage', 'idLocation', 'note', 'deliveryDate']) if (r[k] !== undefined && r[k] !== null) x[k] = r[k]; return x; });
  return c;
};

const giacenze = (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto);
const ordiniApp = (await giobby.ordiniVendita()).filter((o) => o.idGiobby === originale.id);
const piano = pianificaPicking({ ordini: ordiniApp.map((o) => ({ id: o.id, consegna: o.consegna, righe: o.righe })), giacenze });
const prelievi = piano.ordini[0].prelievi;
log('Lotti scelti dal picking:', prelievi.map((p) => `${p.articolo} ${p.lotto} ${p.quantita}`).join(' | '));

let idDdt = null;
try {
  // 1) spezzo la riga dell'ordine: una riga per ogni lotto scelto dal picking
  const nuoveRighe = [];
  for (const r of originale.rows) {
    if (r.idPosType !== 1) { nuoveRighe.push(r); continue; }
    const lotti = prelievi.filter((p) => p.articolo === String(r.idMaterial).toUpperCase());
    lotti.forEach((p, k) => { const copia = { ...r, quantity: p.quantita }; if (k > 0) delete copia.idPos; nuoveRighe.push(copia); });
  }
  await g.richiesta('PUT', `/sales/${ID}/orders`, { body: corpoOrdine(originale, nuoveRighe) });
  const spezzato = await leggiOrdine();
  log(`1) Ordine spezzato. Righe: ${righe(spezzato.rows)}`);

  // 2) DDT dall'ordine, poi lotti
  idDdt = (await g.post(`/sales/${ID}/orderstogoodsissue`, { idNumerator: '1', docDate: String(dataGiobby(oggiIso())), idDocumentTypeExt: '0' })).idDocument;
  const { document: doc } = await g.get(`/sales/${idDdt}/goodsissue`);
  log(`2) DDT ${idDdt} dall'ordine. Righe: ${righe(doc.rows)}`);
  const ddt = { righe: prelievi.map((p) => ({ codice_articolo: p.articolo, quantita: p.quantita, lotto: p.lotto, data_scadenza: p.scadenza })) };
  const { documento: nuovo } = adattaEntrataMerci(doc, ddt);
  const corpo = corpoPerAggiornamento(nuovo);
  corpo.rows.forEach((riga, i) => { const o = nuovo.rows[i]; if (o.saleorderref != null) riga.saleorderref = o.saleorderref; if (o.saleorderposref != null) riga.saleorderposref = o.saleorderposref; });
  await g.richiesta('PUT', `/sales/${idDdt}/goodsissue`, { body: corpo });
  const { document: dopo } = await g.get(`/sales/${idDdt}/goodsissue`);
  log(`3) DDT con i lotti. Righe: ${righe(dopo.rows)}`);
  const o = await leggiOrdine();
  log(`   Ordine ora: ${o.docStatusDesc} (${o.docStatus}); righe ordine: ${o.rows.map((x) => `${x.idMaterial} ${x.quantity} ${x.docposstatus}`).join('; ')}`);
  const rep = await g.get('/stocks/avaibility/report', { lotsDetail: 'true', storageDetail: 'true' });
  log(`   Giacenze lotti scelti: ${(rep.stockReports ?? []).filter((s) => prelievi.some((p) => p.articolo === s.idMaterial && p.lotto === s.idLot)).map((s) => `${s.idMaterial}/${s.idLot}=${s.quantity}`).join(', ') || '(nessuno: lotti esauriti)'}`);
  log(`   RISULTATO: ${o.docStatus === 'GOOD_DELIVERY' ? 'OK, ordine "Merce spedita" con due lotti' : 'ordine NON completamente spedito'}`);
} catch (e) {
  log(`✖ ${e instanceof GiobbyError ? e.message : e} ${e.dettaglio ? JSON.stringify(e.dettaglio).slice(0, 400) : ''}`);
} finally {
  // ripristino: cancello il DDT e rimetto l'ordine com'era
  if (idDdt) { try { await g.richiesta('DELETE', `/sales/${idDdt}/goodsissue`); log(`Ripristino: DDT ${idDdt} cancellato`); } catch (e) { log(`✖ DDT ${idDdt} NON cancellato: usa  node scripts/ddt-uscita-stato.js ${idDdt} --cancella`); } }
  try {
    const attuale = await leggiOrdine();
    await g.richiesta('PUT', `/sales/${ID}/orders`, { body: corpoOrdine(attuale, originale.rows) });
    const fine = await leggiOrdine();
    log(`Ripristino: ordine ${fine.docStatusDesc}. Righe: ${righe(fine.rows)}`);
  } catch (e) { log(`✖ Ordine NON ripristinato: ${e.message}`); }
  log('FINE');
}
