// Prova sul SANDBOX: secondo DDT sullo stesso ordine (primo parziale, poi il resto). Poi ripristina tutto. Esito in data/esito-ddt-secondo.txt
//   node scripts/ddt-uscita-secondo.js
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';
import { corpoOrdineVendita } from '../src/giobbyCarico.js';
import { pianificaPicking } from '../src/picking.js';

const FILE = path.join(config.dataDir, 'esito-ddt-secondo.txt');
fs.mkdirSync(config.dataDir, { recursive: true });
fs.writeFileSync(FILE, `Prova ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };
if (!/^sb-/i.test(config.giobbyCid || '')) { log('✖ Non è un sandbox: mi fermo.'); process.exit(1); }

const ID = 1;
const g = new GiobbyHttp(); await g.login();
const giobby = new ApiGiobby(g);
const leggi = async () => (await g.get(`/sales/${ID}/orders`)).document;
const stato = async (t) => { const o = await leggi(); log(`${t}: ${o.docStatus} (${o.docStatusDesc}) | ${o.rows.filter((x) => x.idPosType === 1).map((x) => `${x.idMaterial} ${x.quantity} ${x.docposstatus}`).join('; ')}`); };
const originale = await leggi();
if (originale.docStatus !== 'CREATED') { log('✖ L\'ordine 1 non è "Creato": cancella prima i DDT di prova.'); process.exit(1); }
await stato('Inizio');
const piano = async (righe) => pianificaPicking({ ordini: [{ id: 'X', righe }], giacenze: (await giobby.giacenze({ magazzino: 'MB' })).filter((x) => x.lotto) }).ordini[0].prelievi;
const ddt = [];
try {
  const p1 = await piano([{ articolo: 'FAR-002', quantita: 30 }]);
  log('DDT 1 (parziale: FAR-002 30):', p1.map((p) => `${p.lotto} ${p.quantita}`).join(' | '));
  const r1 = await giobby.emettiDdtUscita(ID, p1, { parziale: true });
  ddt.push(r1.idDdt); log(`✔ DDT 1 ${r1.riferimento} (id ${r1.idDdt}) · ordine: ${r1.statoOrdine}`);
  await stato('Dopo DDT 1');
  const aperte = (await giobby.ordiniVendita()).find((o) => o.idGiobby === ID);
  log('Picking vede ancora da evadere:', aperte ? aperte.righe.map((r) => `${r.articolo} ${r.quantita}`).join('; ') : '(l\'ordine non compare)');
  if (aperte) {
    const p2 = await piano(aperte.righe.map((r) => ({ articolo: r.articolo, quantita: r.quantita })));
    log('DDT 2 (il resto):', p2.map((p) => `${p.articolo} ${p.lotto} ${p.quantita}`).join(' | '));
    try {
      const r2 = await giobby.emettiDdtUscita(ID, p2, { parziale: false });
      ddt.push(r2.idDdt); log(`✔ DDT 2 ${r2.riferimento} (id ${r2.idDdt}) · ordine: ${r2.statoOrdine}`);
      await stato('Dopo DDT 2');
    } catch (e) { log(`✖ DDT 2 rifiutato: ${e.message}`); await stato('Dopo errore DDT 2'); }
  }
} catch (e) { log(`✖ ${e.message}`); }
finally {
  for (const id of ddt.reverse()) { try { await g.richiesta('DELETE', `/sales/${id}/goodsissue`); log(`Ripristino: DDT ${id} cancellato`); } catch (e) { log(`✖ cancella a mano il DDT ${id}: ${e.message}`); } }
  try { await g.richiesta('PUT', `/sales/${ID}/orders`, { body: corpoOrdineVendita(await leggi(), originale.rows) }); await stato('Ripristino'); } catch (e) { log(`✖ ordine non ripristinato: ${e.message}`); }
  log('FINE');
}
