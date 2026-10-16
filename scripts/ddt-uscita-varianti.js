// Prova in automatico diversi modi di mettere DUE LOTTI sullo stesso articolo in un DDT di uscita (sandbox).
// Per ogni variante: crea il DDT, lo corregge, rilegge righe e stato ordine, poi CANCELLA il DDT e controlla che l'ordine torni "Creato".
//   node scripts/ddt-uscita-varianti.js
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { adattaEntrataMerci, corpoPerAggiornamento, dataGiobby, oggiIso } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

if (!/^sb-/i.test(config.giobbyCid || '')) { console.error('✖ Non è un sandbox (cid "sb-..."): mi fermo.'); process.exit(1); }
const ID_ORDINE = '1';
const g = new GiobbyHttp();
await g.login();
const giobby = new ApiGiobby(g);
const oggi = String(dataGiobby(oggiIso()));

const statoOrdine = async () => (await g.get(`/sales/${ID_ORDINE}/orders`)).document;
let ordine = await statoOrdine();
if (ordine.docStatus !== 'CREATED') { console.error(`✖ L'ordine è "${ordine.docStatusDesc}": prima cancella i DDT di prova con  node scripts/ddt-uscita-stato.js <id> --cancella`); process.exit(1); }

const giacenze = (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto);
const ordiniApp = (await giobby.ordiniVendita()).filter((o) => o.idGiobby === ordine.id);
const piano = pianificaPicking({ ordini: ordiniApp.map((o) => ({ id: o.id, consegna: o.consegna, righe: o.righe })), giacenze });
const prelievi = piano.ordini[0].prelievi;
console.log('Lotti scelti dal picking:', prelievi.map((p) => `${p.articolo} ${p.lotto} ${p.quantita}`).join(' | '), '\n');
const posDi = new Map(ordine.rows.filter((r) => r.idPosType === 1).map((r) => [String(r.idMaterial).toUpperCase(), r]));
const riassunto = (rows) => rows.filter((x) => x.idPosType === 1).map((x) => `${x.idMaterial} ${x.quantity} ${x.idLot || '-'} (rif ${x.saleorderref ?? '-'}/${x.saleorderposref ?? '-'})`).join('; ');

// Ogni variante crea un DDT e ritorna il suo id
async function daOrdine({ pos, copie }) {
  const r = await g.post(`/sales/${ID_ORDINE}/orderstogoodsissue`, { idNumerator: '1', docDate: oggi, idDocumentTypeExt: '0' });
  const id = r.idDocument;
  const { document: doc } = await g.get(`/sales/${id}/goodsissue`);
  const ddt = { righe: prelievi.map((p) => ({ codice_articolo: p.articolo, quantita: p.quantita, lotto: p.lotto, data_scadenza: p.scadenza })) };
  const { documento: nuovo } = adattaEntrataMerci(doc, ddt);
  const posOriginali = new Set(doc.rows.map((x) => x.idPos));
  const corpo = corpoPerAggiornamento(nuovo);
  corpo.rows.forEach((riga, i) => {
    const o = nuovo.rows[i];
    const copiata = !posOriginali.has(o.idPos);
    if (copiata) {
      if (pos === 'senza') delete riga.idPos;
      if (pos === 'zero') riga.idPos = 0;
      if (pos === 'meno1') riga.idPos = -1;
    }
    if (copiata && copie === 'nessuno') return;
    if (o.saleorderref != null) riga.saleorderref = o.saleorderref;
    if (o.saleorderposref != null && !(copiata && copie === 'solo-ordine')) riga.saleorderposref = o.saleorderposref;
  });
  await g.richiesta('PUT', `/sales/${id}/goodsissue`, { body: corpo });
  return id;
}
async function diretto() {
  const corpo = {
    idDocumentType: 1, idDocumentTypeExt: '0', idCustomer: ordine.idCustomer, idContact: String(ordine.idContact),
    docDate: oggi, docCurrency: 'EUR', idBu: ordine.idBu, idNumerator: '1', note: '', internalNote: 'PROVA VARIANTI',
    rows: prelievi.map((p) => { const r = posDi.get(p.articolo); return { idMaterial: p.articolo, idPosType: '1', quantity: String(p.quantita), price: String(r.price), idVat: String(r.idVat), description: r.description || p.articolo, idStorage: 'MB', idLot: p.lotto }; }),
  };
  const id = (await g.post('/sales/goodsissue', corpo)).idDocument;
  // secondo passo: si prova ad agganciare le righe all'ordine con una modifica
  const { document: doc } = await g.get(`/sales/${id}/goodsissue`);
  const body = corpoPerAggiornamento(doc);
  body.rows.forEach((riga) => { const r = posDi.get(String(riga.idMaterial).toUpperCase()); if (r) { riga.saleorderref = ordine.id; riga.saleorderposref = r.idPos; } });
  await g.richiesta('PUT', `/sales/${id}/goodsissue`, { body });
  return id;
}

const varianti = [
  { nome: '1) da ordine, riga copiata SENZA idPos, senza riferimenti', crea: () => daOrdine({ pos: 'senza', copie: 'nessuno' }) },
  { nome: '2) da ordine, riga copiata SENZA idPos, stessi riferimenti', crea: () => daOrdine({ pos: 'senza', copie: 'uguali' }) },
  { nome: '3) da ordine, riga copiata con idPos 0', crea: () => daOrdine({ pos: 'zero', copie: 'nessuno' }) },
  { nome: '4) da ordine, riga copiata con idPos -1', crea: () => daOrdine({ pos: 'meno1', copie: 'nessuno' }) },
  { nome: '5) DDT diretto con i lotti, poi modifica per agganciare l\'ordine', crea: diretto },
];

const tabella = [];
for (const v of varianti) {
  console.log(`--- ${v.nome}`);
  let id = null;
  try {
    id = await v.crea();
    const { document: d } = await g.get(`/sales/${id}/goodsissue`);
    const o = await statoOrdine();
    const duelotti = d.rows.filter((x) => x.idPosType === 1 && x.idMaterial === 'FAR-002' && x.idLot).length >= 2;
    console.log(`   DDT ${id}: ${riassunto(d.rows)}`);
    console.log(`   ordine: ${o.docStatusDesc} | due lotti su FAR-002: ${duelotti ? 'SÌ' : 'no'}`);
    tabella.push({ variante: v.nome, duelotti, ordine: o.docStatus });
  } catch (e) {
    console.log(`   ✖ ${e instanceof GiobbyError ? e.message : e}${e.dettaglio ? ' ' + JSON.stringify(e.dettaglio).slice(0, 300) : ''}`);
    tabella.push({ variante: v.nome, errore: String(e.message || e).slice(0, 120) });
  }
  if (id) {
    try { await g.richiesta('DELETE', `/sales/${id}/goodsissue`); }
    catch (e) { console.error(`✖ Non riesco a cancellare il DDT ${id}: mi fermo. Fallo con  node scripts/ddt-uscita-stato.js ${id} --cancella`); process.exit(1); }
  }
  ordine = await statoOrdine();
  if (ordine.docStatus !== 'CREATED') { console.error(`✖ Dopo la cancellazione l'ordine è "${ordine.docStatusDesc}": mi fermo.`); process.exit(1); }
  console.log('   (DDT cancellato, ordine di nuovo "Creato")\n');
}
console.log('RIEPILOGO');
for (const t of tabella) console.log(`  ${t.errore ? `✖ ${t.errore}` : `due lotti: ${t.duelotti ? 'SÌ' : 'no'} | ordine: ${t.ordine}`}  <- ${t.variante}`);
