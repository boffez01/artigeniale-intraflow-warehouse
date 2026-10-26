import { config } from './config.js';
import { createApp } from './app.js';
import { aggiornaTutteLeConsegne } from './service.js';
import { quantiUtenti } from './auth.js';

createApp().listen(config.port, () => {
  console.log(`http://localhost:${config.port}`);
  if (!config.auth) console.log('⚠ AUTH=off: accesso SENZA login (solo per prove in locale).');
  else if (!quantiUtenti()) console.log('⚠ Nessun utente: nessuno può entrare. Crea il primo amministratore con:  npm run utente -- crea <nome> admin "Nome Cognome"');
  aggiornaTutteLeConsegne().catch(() => {}); // etichette "Consegna parziale" dei DDT già caricati, in secondo piano
});
