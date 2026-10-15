// Prova: crea un nuovo ordine di acquisto per il residuo di un ordine chiuso, con "ODA n" nei riferimenti interni.
//   node scripts/ordine-residuo.js 2 --righe FAR-002=40,FAR-003=15 --data 2026-11-05            -> SIMULAZIONE
//   node scripts/ordine-residuo.js 2 --righe FAR-002=40,FAR-003=15 --data 2026-11-05 --scrivi   -> scrive (solo sandbox)
// Senza --righe usa le quantità intere dell'ordine di partenza (serve solo per la prova).
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { corpoPerAggiornamento, dataGiobby, oggiIso } from '../src/giobbyCarico.js';

const args = process.argv.slice(2);
const valore = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const id = args.find((a, i) => !a.startsWith('--') && !['--righe', '--data'].includes(args[i - 1]));
const scrivi = args.includes('--scrivi');
if (!id) { console.error('Uso: node scripts/ordine-residuo.js <id ordine> [--righe CODICE=qta,CODICE=qta] [--data AAAA-MM-GG] [--scrivi]'); process.exit(1); }
if (scrivi && !/^sb-/i.test(config.giobbyCid || '')) { console.error('Scrittura consentita solo su un sandbox (cid "sb-...").'); process.exit(1); }
const residui = valore('--righe') ? Object.fromEntries(valore('--righe').split(',').map((s) => s.split('='))) : null;
const consegna = dataGiobby(valore('--data') || oggiIso());

const g = new GiobbyHttp();
try {
  await g.login();
  const { document: vecchio } = await g.richiesta('GET', `/purchases/${id}/orders`);
  console.log(`Ordine di partenza: ${vecchio.docDescription} (stato ${vecchio.docStatus})`);
  const base = corpoPerAggiornamento(vecchio);
  delete base.docNumber; // il numero lo assegna Giobby
  const righe = base.rows
    .map(({ idPos, ...r }) => ({ ...r, quantity: residui ? Number(residui[r.idMaterial] ?? 0) : r.quantity, deliveryDate: consegna }))
    .filter((r) => r.quantity > 0);
  if (!righe.length) throw new Error('Nessuna riga con quantità > 0: controlla --righe');
    const corpo = { ...base, idBu: vecchio.idBu, docDate: dataGiobby(oggiIso()), docStatus: 'CREATED', internalNote: `ODA ${vecchio.docNumber}`, rows: righe };
  const percorso = `/purchases/orders${scrivi ? '' : '?simulation=true'}`;
  console.log(`\nPOST ${percorso}${scrivi ? '' : '   [SIMULAZIONE]'}`);
  console.log(`Righe: ${righe.map((r) => `${r.idMaterial} x ${r.quantity}`).join(', ')} · consegna ${valore('--data') || oggiIso()} · internalNote "${corpo.internalNote}"`);
  const r = await g.richiesta('POST', percorso, { body: corpo });
  const d = r.document ?? {};
  console.log(JSON.stringify({ responseCode: r.responseCode, errorCode: r.errorCode, userMessage: r.userMessage, developerMessage: r.developerMessage, id: d.id, docDescription: d.docDescription, docStatus: d.docStatus, internalNote: d.internalNote, warnings: r.concatWarningMessages }, null, 2));
  if (scrivi && d.id) {
    const { document: nuovo } = await g.richiesta('GET', `/purchases/${d.id}/orders`);
    console.log(`\nLetto da Giobby: ${nuovo.docDescription}, stato ${nuovo.docStatus}, riferimenti interni "${nuovo.internalNote}"`);
    console.log(nuovo.rows.map((x) => `  ${x.idMaterial} x ${x.quantity}  consegna ${x.deliveryDate ?? '-'}`).join('\n'));
  }
} catch (e) {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 2500));
  process.exit(1);
}