// Prova del collegamento a Giobby e piccolo "esploratore" delle API.
//
// LETTURE (GET, non modificano nulla):
//   node scripts/giobby-test.js                              -> login + GET /loggeduser
//   node scripts/giobby-test.js /lots /products              -> più percorsi in un colpo solo
//   node scripts/giobby-test.js /lots --salva lot            -> salva la risposta completa in data/giobby-lot.json
//
// SCRITTURE (POST/PUT con un file JSON; partono SOLO se il cid è un sandbox "sb-..." oppure con --conferma):
//   node scripts/giobby-test.js --post "/purchases/goodsreceipt?simulation=true" --file prova/em.json
//   node scripts/giobby-test.js --put  "/purchases/1/goodsreceipt" --file prova/em1.json
//
// Legge le credenziali dal file .env.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';

const args = process.argv.slice(2);
const OPZIONI_CON_VALORE = ['--salva', '--post', '--put', '--file'];
const valore = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const nomeFile = valore('--salva');
const scrittura = valore('--post') ? ['POST', valore('--post')] : valore('--put') ? ['PUT', valore('--put')] : null;
const fileCorpo = valore('--file');
const conferma = args.includes('--conferma');

const percorsi = args.filter((a, i) => !a.startsWith('--') && !OPZIONI_CON_VALORE.includes(args[i - 1]));
if (!percorsi.length) percorsi.push('/loggeduser');
const maxStampa = percorsi.length > 1 ? 800 : 4000;

const stampaErrore = (e) => {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 2500));
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

if (scrittura) {
  const [metodo, percorso] = scrittura;
  try {
    if (!fileCorpo) throw new Error('Manca il file con il corpo della richiesta: aggiungi --file percorso/del/file.json');
    if (!/^sb-/i.test(config.giobbyCid || '') && !conferma) {
      throw new Error('Questo account non sembra un sandbox (il cid non inizia con "sb-"). Per scrivere davvero aggiungi --conferma.');
    }
    const corpo = JSON.parse(fs.readFileSync(fileCorpo, 'utf8'));
    console.log(`\n${metodo} ${percorso}   (corpo: ${fileCorpo})`);
    const risposta = await g.richiesta(metodo, percorso, { body: corpo });
    const testo = JSON.stringify(risposta, null, 2);
    console.log(testo.length > 6000 ? `${testo.slice(0, 6000)}\n… (troncato: ${testo.length} caratteri)` : testo);
    if (nomeFile) {
      const file = path.join(config.dataDir, `giobby-${nomeFile.replace(/[^\w-]/g, '_')}.json`);
      fs.writeFileSync(file, testo);
      console.log(`Risposta completa salvata in ${file}`);
    }
  } catch (e) {
    stampaErrore(e);
    process.exitCode = 1;
  }
} else {
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
}