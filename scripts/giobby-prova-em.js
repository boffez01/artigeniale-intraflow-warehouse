// Prova: adatta un'Entrata Merci già creata da un ordine a quello che dice un DDT.
//
//   node scripts/giobby-prova-em.js 3 prova/ddt-parziale.json            -> mostra cosa cambierebbe (NON scrive)
//   node scripts/giobby-prova-em.js 3 prova/ddt-parziale.json --invia --simulazione  -> PUT con simulation=true (Giobby non scrive)
//   node scripts/giobby-prova-em.js 3 prova/ddt-parziale.json --invia    -> modifica davvero l'Entrata Merci su Giobby
//
// Il DDT è un JSON con righe[] come quelle lette da Gemini: codice_articolo, quantita, lotto, data_scadenza (AAAA-MM-GG).
// Le scritture partono solo se il cid è un sandbox ("sb-...") oppure con --conferma.
import fs from 'node:fs';
import { config } from '../src/config.js';
import { adattaEntrataMerci, corpoPerAggiornamento, descriviRiga } from '../src/giobbyCarico.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';

const [idEm, fileDdt] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const invia = process.argv.includes('--invia');
const conferma = process.argv.includes('--conferma');
const leggi = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

const mostra = (titolo, righe) => {
  console.log(`\n${titolo}`);
  for (const r of righe) console.log(`  ${descriviRiga(r)}`);
};

try {
  if (!idEm || !fileDdt) throw new Error('Uso: node scripts/giobby-prova-em.js <id Entrata Merci> <file DDT .json> [--invia]');
  if (invia && !/^sb-/i.test(config.giobbyCid || '') && !conferma) {
    throw new Error('Questo account non sembra un sandbox (il cid non inizia con "sb-"). Per scrivere davvero aggiungi --conferma.');
  }
  const ddt = leggi(fileDdt);
  const g = new GiobbyHttp();
  await g.login();
  console.log(`✔ Login riuscito (idCompany ${g.sessione.idCompany})`);

  const letta = await g.get(`/purchases/${encodeURIComponent(idEm)}/goodsreceipt`);
  const documento = letta.document;
  console.log(`Entrata Merci ${documento.id}: ${documento.docDescription} (${documento.docStatusDesc})`);
  mostra('RIGHE ATTUALI', documento.rows);

  const { documento: nuovo, avvisi } = adattaEntrataMerci(documento, ddt);
  mostra('RIGHE DOPO LA CORREZIONE', nuovo.rows);
  if (avvisi.length) console.log(`\nAvvisi:\n${avvisi.map((a) => `  - ${a}`).join('\n')}`);

  if (!invia) {
    console.log('\n(Prova a vuoto: non ho scritto nulla. Aggiungi --invia per modificare davvero.)');
  } else {
    console.log(`\nPUT /purchases/${idEm}/goodsreceipt ...`);
    const simulazione = process.argv.includes('--simulazione');
    const esito = await g.richiesta('PUT', `/purchases/${encodeURIComponent(idEm)}/goodsreceipt`, { query: simulazione ? { simulation: 'true' } : undefined, body: corpoPerAggiornamento(nuovo) });
    console.log(JSON.stringify(esito, null, 2));
    const dopo = await g.get(`/purchases/${encodeURIComponent(idEm)}/goodsreceipt`);
    mostra('RIGHE LETTE DI NUOVO DA GIOBBY', dopo.document.rows);
    console.log(`Totale documento: ${dopo.document.totalAmount}  (prima: ${documento.totalAmount})`);
    console.log('\nOra controlla con: node scripts/giobby-test.js /purchases/orders');
  }
} catch (e) {
  console.error(`\n✖ ${e instanceof GiobbyError ? e.message : e.message || e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 2500));
  process.exitCode = 1;
}