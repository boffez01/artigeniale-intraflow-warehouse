// Esplorazione del DDT di uscita su Giobby, SOLO SIMULAZIONE (simulation=true): non salva niente.
//   node scripts/ddt-uscita-prova.js        -> usa l'ordine di vendita 1
//   node scripts/ddt-uscita-prova.js 2      -> usa l'ordine di vendita 2
// Prova "da ordine a DDT di uscita" (come per gli acquisti) e poi un DDT scritto a mano con i lotti.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { dataGiobby, oggiIso } from '../src/giobbyCarico.js';

if (!/^sb-/i.test(config.giobbyCid || '')) { console.error('✖ Non è un sandbox (cid "sb-..."): mi fermo.'); process.exit(1); }
const idOrdine = process.argv[2] || '1';
const g = new GiobbyHttp();
await g.login();
console.log(`✔ Login riuscito (cid ${config.giobbyCid}). Ordine di vendita ${idOrdine}. Tutte le chiamate sono simulazioni.\n`);

const risultati = [];
async function prova(nome, metodo, percorso, body) {
  console.log(`--- ${nome}\n${metodo} ${percorso}`);
  try {
    const r = await g.richiesta(metodo, percorso, body ? { body } : {});
    const testo = JSON.stringify(r, null, 2);
    console.log(testo.length > 3000 ? `${testo.slice(0, 3000)}\n… (troncato)` : testo);
    risultati.push({ nome, ok: true, risposta: r });
  } catch (e) {
    console.log(`✖ ${e instanceof GiobbyError ? e.message : e}`);
    if (e instanceof GiobbyError && e.dettaglio) console.log(JSON.stringify(e.dettaglio, null, 2).slice(0, 1500));
    risultati.push({ nome, ok: false, errore: String(e.message || e), dettaglio: e.dettaglio ?? null });
  }
  console.log();
}

const oggi = String(dataGiobby(oggiIso()));
await prova('A) DDT di uscita dall\'ordine', 'POST', `/sales/${idOrdine}/orderstogoodsissue?simulation=true`,
  { idNumerator: '1', docDate: oggi, idDocumentTypeExt: '0' });
await prova('B) DDT di uscita dall\'ordine (con magazzino)', 'POST', `/sales/${idOrdine}/orderstogoodsissue?simulation=true`,
  { idNumerator: '1', docDate: oggi, idDocumentTypeExt: '0', srcIdStorage: 'MB' });
await prova('C) Elenco DDT di uscita esistenti', 'GET', '/sales/goodsissue');

const { document: ordine } = await g.get(`/sales/${idOrdine}/orders`);
const corpo = {
  idDocumentType: 1, idDocumentTypeExt: '0', idCustomer: ordine.idCustomer, idContact: String(ordine.idContact),
  docDate: oggi, docCurrency: 'EUR', idBu: ordine.idBu, idNumerator: '1',
  note: 'PROVA DDT USCITA', internalNote: '',
  rows: ordine.rows.filter((r) => r.idPosType === 1).map((r) => ({
    idMaterial: r.idMaterial, idPosType: '1', quantity: String(r.quantity), price: String(r.price), idVat: String(r.idVat),
    description: r.description, idStorage: 'MB', idLot: r.idMaterial === 'FAR-002' ? 'L2610A' : '',
    saleorderref: String(ordine.id), saleorderposref: String(r.idPos),
  })),
};
await prova('D) DDT di uscita scritto a mano con lotto e riferimento all\'ordine', 'POST', '/sales/goodsissue?simulation=true', corpo);

fs.writeFileSync(path.join(config.dataDir, 'giobby-ddt-uscita-prova.json'), JSON.stringify(risultati, null, 2));
console.log(`Risposte complete salvate in ${path.join(config.dataDir, 'giobby-ddt-uscita-prova.json')}`);
