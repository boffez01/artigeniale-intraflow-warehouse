// Prova la funzione VERA dell'app (emettiDdtUscita) sul sandbox, poi ripristina tutto. Esito anche in data/esito-ddt-app.txt
//   node scripts/ddt-uscita-app.js            ordine completo (lotti scelti dal picking)
//   node scripts/ddt-uscita-app.js --parziale correzione dell'operatore: FAR-002 solo 40 su 50, FAR-003 niente
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';
import { corpoOrdineVendita } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

const FILE = path.join(config.dataDir, 'esito-ddt-app.txt');
fs.writeFileSync(FILE, `Prova ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };
if (!/^sb-/i.test(config.giobbyCid || '')) { log('✖ Non è un sandbox: mi fermo.'); process.exit(1); }

const ID = 1;
const parziale = process.argv.includes('--parziale');
const g = new GiobbyHttp(); await g.login();
const giobby = new ApiGiobby(g);
const leggi = async () => (await g.get(`/sales/${ID}/orders`)).document;
const originale = await leggi();
log(`Ordine ${originale.docDescription}: ${originale.docStatusDesc}`);
if (originale.docStatus !== 'CREATED') { log('✖ L\'ordine non è "Creato": cancella prima i DDT di prova (ddt-uscita-stato.js <id> --cancella).'); process.exit(1); }

const ordine = (await giobby.ordiniVendita()).find((o) => o.idGiobby === ID);
const piano = pianificaPicking({ ordini: [{ id: ordine.id, consegna: ordine.consegna, righe: ordine.righe }], giacenze: (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto) });
let prelievi = piano.ordini[0].prelievi;
if (parziale) prelievi = prelievi.filter((p) => p.articolo === 'FAR-002').map((p, i) => ({ ...p, quantita: i === 0 ? Math.min(p.quantita, 40) : 0 }));
log('Prelievi:', prelievi.map((p) => `${p.articolo} ${p.lotto} ${p.quantita}`).join(' | '));

let idDdt = null;
try {
  const r = await giobby.emettiDdtUscita(ID, prelievi);
  idDdt = r.idDdt;
  log(`✔ ${r.riferimento} (id ${r.idDdt}) · ordine: ${r.statoOrdine} · avvisi: ${r.avvisi.join('; ') || 'nessuno'}`);
  const { document: d } = await g.get(`/sales/${idDdt}/goodsissue`);
  log('DDT:', d.rows.filter((x) => x.idPosType === 1).map((x) => `${x.idMaterial} ${x.quantity} lotto ${x.idLot || '-'} rif ${x.saleorderref}/${x.saleorderposref}`).join('; '));
  const o = await leggi();
  log('Ordine:', o.docStatusDesc, '|', o.rows.map((x) => `${x.idMaterial} ${x.quantity} ${x.docposstatus}`).join('; '));
} catch (e) { log(`✖ ${e.message}`); }
finally {
  if (idDdt) { try { await g.richiesta('DELETE', `/sales/${idDdt}/goodsissue`); log(`Ripristino: DDT ${idDdt} cancellato`); } catch { log(`✖ cancella a mano: node scripts/ddt-uscita-stato.js ${idDdt} --cancella`); } }
  try { await g.richiesta('PUT', `/sales/${ID}/orders`, { body: corpoOrdineVendita(await leggi(), originale.rows) }); const f = await leggi(); log(`Ripristino: ordine ${f.docStatusDesc}, ${f.rows.length} righe`); } catch (e) { log(`✖ ordine non ripristinato: ${e.message}`); }
  log('FINE');
}
