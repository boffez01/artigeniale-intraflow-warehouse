// Prova del collegamento a Giobby e piccolo "esploratore" delle API (solo letture, GET).
//
//   npm run giobby:test                         -> login + GET /loggeduser
//   npm run giobby:test -- /lots                -> GET su un altro percorso
//   npm run giobby:test -- /lots /products      -> più percorsi in un colpo solo (un errore non ferma gli altri)
//   npm run giobby:test -- /lots --salva lot    -> salva la risposta completa in data/giobby-lot.json
//
// Legge le credenziali dal file .env. Non scrive e non cancella nulla su Giobby.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';

const args = process.argv.slice(2);
const iSalva = args.indexOf('--salva');
const nomeFile = iSalva >= 0 ? args[iSalva + 1] : null;
const percorsi = args.filter((a, i) => !a.startsWith('--') && !(iSalva >= 0 && i === iSalva + 1));
if (!percorsi.length) percorsi.push('/loggeduser');
const maxStampa = percorsi.length > 1 ? 800 : 4000;

const stampaErrore = (e) => {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 1500));
};

const g = new GiobbyHttp();
try {
  console.log(`Accedo a Giobby (utente ${config.giobbyUser || '?'}, cid ${config.giobbyCid || '?'}, realm ${config.giobbyRealm})...`);
  await g.login();
  console.log(`✔ Login riuscito. idCompany: ${g.sessione.idCompany}`);
  console.log(`✔ Indirizzo API: ${g.sessione.apiUrl}`);
} catch (e) {
  stampaErrore(e);
  process.exit(1);
}

for (const percorso of percorsi) {
  console.log(`\nGET ${percorso}`);
  try {
    const testo = JSON.stringify(await g.get(percorso), null, 2);
    console.log(testo.length > maxStampa ? `${testo.slice(0, maxStampa)}\n… (troncato: ${testo.length} caratteri, usa --salva per il file intero)` : testo);
    if (nomeFile && percorso === percorsi[0]) {
      const file = path.join(config.dataDir, `giobby-${nomeFile.replace(/[^\w-]/g, '_')}.json`);
      fs.writeFileSync(file, testo);
      console.log(`Risposta completa salvata in ${file}`);
    }
  } catch (e) {
    stampaErrore(e);
  }
}