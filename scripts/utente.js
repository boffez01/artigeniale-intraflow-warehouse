// Gestione utenti da terminale (il primo amministratore si crea da qui).
//   npm run utente -- crea <utente> <admin|ufficio|magazzino> ["Nome Cognome"]
//   npm run utente -- password <utente>
//   npm run utente -- disattiva <utente>     npm run utente -- attiva <utente>
//   npm run utente -- elenco
// La password si scrive quando richiesta (non compare a schermo e non resta nella cronologia dei comandi).
import readline from 'node:readline';
import { cambiaPassword, creaUtente, elencoUtenti, impostaAttivo } from '../src/auth.js';

const [comando, username, ruolo, ...nome] = process.argv.slice(2);

function chiediPassword(domanda) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (t) => { if (t.includes(domanda)) process.stdout.write(t); };
    rl.question(domanda, (p) => { rl.close(); process.stdout.write('\n'); ok(p); });
  });
}
async function nuovaPassword() {
  const a = await chiediPassword('Password (almeno 8 caratteri): ');
  const b = await chiediPassword('Ripeti la password: ');
  if (a !== b) throw new Error('Le due password non coincidono');
  return a;
}
const trova = () => {
  const u = elencoUtenti().find((x) => x.username.toLowerCase() === String(username).toLowerCase());
  if (!u) throw new Error(`Utente "${username}" non trovato`);
  return u;
};

try {
  if (comando === 'crea' && username && ruolo) {
    const u = creaUtente({ username, nome: nome.join(' ') || username, ruolo, password: await nuovaPassword() });
    console.log(`✔ Creato ${u.username} (${u.ruolo})`);
  } else if (comando === 'password' && username) {
    cambiaPassword(trova().id, await nuovaPassword());
    console.log('✔ Password cambiata (le sessioni aperte di questo utente sono state chiuse)');
  } else if (comando === 'disattiva' && username) { impostaAttivo(trova().id, false); console.log('✔ Utente disattivato'); }
  else if (comando === 'attiva' && username) { impostaAttivo(trova().id, true); console.log('✔ Utente attivato'); }
  else if (comando === 'elenco') {
    for (const u of elencoUtenti()) console.log(`${u.attivo ? '●' : '○'} ${u.username.padEnd(20)} ${u.ruolo.padEnd(10)} ${u.nome}  (ultimo accesso: ${u.ultimo_accesso ?? 'mai'})`);
  } else {
    console.log('Uso:\n  npm run utente -- crea <utente> <admin|ufficio|magazzino> ["Nome Cognome"]\n  npm run utente -- password <utente>\n  npm run utente -- disattiva|attiva <utente>\n  npm run utente -- elenco');
    process.exit(1);
  }
} catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
