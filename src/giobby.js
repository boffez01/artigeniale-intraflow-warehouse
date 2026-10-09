// Client Giobby.
// DryRun: scrive il payload in data/outbox (sviluppo e collaudo senza toccare il gestionale).
// ApiGiobby: DA IMPLEMENTARE appena Artigeniale ci dà accesso e documentazione API.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { GiobbyHttp } from './giobbyHttp.js';

class DryRunGiobby {
  async registraCarico(ddt, { chiave } = {}) {
    const ref = `DRY-${new Date().toISOString().replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(path.join(config.outboxDir, `${ref}.json`), JSON.stringify({ chiave, ...ddt }, null, 2));
    return ref;
  }
}

class ApiGiobby {
  // Login e chiamate HTTP sono pronti (src/giobbyHttp.js, provati con `npm run giobby:test`): this.http.get/post(...)
  http = new GiobbyHttp();

  async registraCarico(_ddt, { chiave } = {}) {
    // TODO: percorsi e campi reali (Entrata Merci da righe d'ordine, lotti con scadenza, ricerca articolo per codice).
    // - Passare `chiave` come riferimento esterno / chiave di idempotenza, e (se l'API lo permette)
    //   cercare prima il documento con quel riferimento: se la risposta va in timeout dopo che Giobby
    //   ha già registrato, un secondo invio non deve duplicare il carico.
    // - Le quantità arrivano già validate (intere per PZ/CT): NON arrotondare qui.
    throw new Error('Integrazione Giobby non ancora implementata');
  }
}

export const getGiobbyClient = () => (config.giobbyMode === 'api' ? new ApiGiobby() : new DryRunGiobby());