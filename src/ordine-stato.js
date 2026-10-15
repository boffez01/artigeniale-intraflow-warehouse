// Prova: cambia lo stato di un ordine di acquisto con il PUT e mostra come risponde Giobby.
//   node scripts/ordine-stato.js 2 COMPLETED_ORDER            -> SIMULAZIONE (simulation=true, non scrive)
//   node scripts/ordine-stato.js 2 COMPLETED_ORDER --scrivi   -> scrive davvero (solo sandbox "sb-")
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { corpoPerAggiornamento } from '../src/giobbyCarico.js';

const [id, stato] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const scrivi = process.argv.includes('--scrivi');
if (!id || !stato) { console.error('Uso: node scripts/ordine-stato.js <id ordine> <STATO> [--scrivi]'); process.exit(1); }
if (scrivi && !/^sb-/i.test(config.giobbyCid || '')) { console.error('Scrittura consentita solo su un sandbox (cid "sb-...").'); process.exit(1); }

const g = new GiobbyHttp();
try {
  await g.login();
  const { document } = await g.richiesta('GET', `/purchases/${id}/orders`);
  console.log(`Ordine ${document.docDescription}: stato attuale ${document.docStatus}`);
  const corpo = { ...corpoPerAggiornamento(document), docStatus: stato };
  const percorso = `/purchases/${id}/orders${scrivi ? '' : '?simulation=true'}`;
  console.log(`\nPUT ${percorso}  (docStatus -> ${stato})${scrivi ? '' : '   [SIMULAZIONE]'}`);
  const r = await g.richiesta('PUT', percorso, { body: corpo });
  const d = r.document ?? r;
  console.log(JSON.stringify({ responseCode: r.responseCode, errorCode: r.errorCode, userMessage: r.userMessage, developerMessage: r.developerMessage, docStatus: d.docStatus, docStatusDesc: d.docStatusDesc, warnings: r.concatWarningMessages }, null, 2));
  if (scrivi) {
    const { document: dopo } = await g.richiesta('GET', `/purchases/${id}/orders`);
    console.log(`\nDopo la scrittura: stato ${dopo.docStatus} (${dopo.docStatusDesc}), righe: ${dopo.rows.map((x) => `${x.idMaterial} ${x.docposstatus}`).join(', ')}`);
  }
} catch (e) {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 2500));
  process.exit(1);
}