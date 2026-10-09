// Prova del collegamento a Giobby e piccolo "esploratore" delle API (solo letture, GET).
//
//   npm run giobby:test                      -> login + GET /loggeduser
//   npm run giobby:test -- /lot              -> GET su un altro percorso
//   npm run giobby:test -- /lot --salva lot  -> salva la risposta completa in data/giobby-lot.json
//
// Legge le credenziali dal file .env. Non scrive e non cancella nulla su Giobby.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';

const args = process.argv.slice(2);
const iSalva = args.indexOf('--salva');
const nomeFile = iSalva >= 0 ? args[iSalva + 1] : null;
const percorso = args.find((a, i) => !a.startsWith('--') && i !== iSalva + 1) || '/loggeduser';
const MAX_STAMPA = 4000;

const g = new GiobbyHttp();
try {
  console.log(`Accedo a Giobby (utente ${config.giobbyUser || '?'}, cid ${config.giobbyCid || '?'}, realm ${config.giobbyRealm})...`);
  await g.login();
  console.log(`✔ Login riuscito. idCompany: ${g.sessione.idCompany}`);
  console.log(`✔ Indirizzo API: ${g.sessione.apiUrl}`);

  console.log(`\nGET ${percorso}`);
  const risposta = await g.get(percorso);
  const testo = JSON.stringify(risposta, null, 2);
  console.log(testo.length > MAX_STAMPA ? `${testo.slice(0, MAX_STAMPA)}\n… (troncato: ${testo.length} caratteri, usa --salva per il file intero)` : testo);

  if (nomeFile) {
    const file = path.join(config.dataDir, `giobby-${nomeFile.replace(/[^\w-]/g, '_')}.json`);
    fs.writeFileSync(file, testo);
    console.log(`\nRisposta completa salvata in ${file}`);
  }
} catch (e) {
  console.error(`\n✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 1500));
  process.exitCode = 1;
}