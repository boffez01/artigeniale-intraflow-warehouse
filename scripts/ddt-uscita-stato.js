// Stato del DDT di uscita creato per errore dalla prova (sandbox). Di default SOLO LETTURA.
//   node scripts/ddt-uscita-stato.js              -> mostra DDT 11, stato ordine 1 e giacenze
//   node scripts/ddt-uscita-stato.js 12           -> come sopra, per il DDT 12
//   node scripts/ddt-uscita-stato.js 12 --cancella -> elimina quel DDT e rilegge ordine e giacenze
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { isoDaGiobby } from '../src/giobbyCarico.js';

if (!/^sb-/i.test(config.giobbyCid || '')) { console.error('✖ Non è un sandbox (cid "sb-..."): mi fermo.'); process.exit(1); }
const ID_DDT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) || '11', ID_ORDINE = '1';
const g = new GiobbyHttp();
await g.login();

async function mostra() {
  try {
    const { document: d } = await g.get(`/sales/${ID_DDT}/goodsissue`);
    console.log(`DDT ${d.docDescription} · stato: ${d.docStatusDesc}`);
    for (const r of d.rows ?? []) console.log(`  riga ${r.idPos}: ${r.idMaterial} q.tà ${r.quantity} lotto "${r.idLot ?? ''}" magazzino ${r.idStorage} (riferimento ordine: ${r.saleorderref ?? '-'}/${r.saleorderposref ?? '-'})`);
  } catch (e) { console.log(`DDT ${ID_DDT}: ${e instanceof GiobbyError ? e.message : e}`); }
  const { document: o } = await g.get(`/sales/${ID_ORDINE}/orders`);
  console.log(`Ordine ${o.docDescription} · stato: ${o.docStatusDesc} (${o.docStatus})`);
  for (const r of o.rows ?? []) console.log(`  riga ${r.idPos}: ${r.idMaterial} q.tà ${r.quantity} stato riga ${r.docposstatus}`);
  const rep = await g.get('/stocks/avaibility/report', { lotsDetail: 'true', storageDetail: 'true' });
  console.log('Giacenze (articolo / lotto / quantità fisica / impegnata):');
  for (const s of rep.stockReports ?? []) if (Number(s.quantity) > 0 || Number(s.reservedByOrdersQty) > 0) console.log(`  ${s.idMaterial} / ${s.idLot || '(senza lotto)'} / ${s.quantity} / ${s.reservedByOrdersQty}`);
}

console.log('=== PRIMA ===');
await mostra();
if (process.argv.includes('--cancella')) {
  console.log(`\nElimino il DDT ${ID_DDT}…`);
  try { console.log(JSON.stringify(await g.richiesta('DELETE', `/sales/${ID_DDT}/goodsissue`))); }
  catch (e) { console.log(`✖ ${e instanceof GiobbyError ? e.message : e}`); if (e.dettaglio) console.log(JSON.stringify(e.dettaglio)); }
  console.log('\n=== DOPO ===');
  await mostra();
}
