// Solo lettura: cerca in Giobby dove sta la PROVINCIA del cliente (nell'ordine di vendita o nell'anagrafica cliente).
//   node scripts/provincia-cerca.js        -> scrive data/esito-provincia.txt
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';

const righe = [`Ricerca provincia ${new Date().toISOString()}`];
const log = (t) => { righe.push(t); console.log(t); };
const g = new GiobbyHttp();
try {
  await g.login();
  const campi = (o) => Object.entries(o ?? {}).filter(([k]) => /prov|addr|city|citt|zip|cap|nation|country/i.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ');
  const elenco = await g.get('/sales/orders');
  const primi = (elenco.documentsHeaders ?? []).slice(0, 3);
  for (const o of primi) {
    const { document } = await g.get(`/sales/${o.id}/orders`);
    log(`\nORDINE ${o.id} (cliente ${document.idCustomer} ${document.companyName}):`);
    log(`  campi ordine: ${campi(document) || '(nessun campo indirizzo/provincia)'}`);
    try {
      const c = await g.get(`/customers/${encodeURIComponent(document.idCustomer)}`);
      const cliente = c.customer ?? c.document ?? c;
      log(`  campi cliente: ${campi(cliente) || '(nessun campo indirizzo/provincia)'}`);
      log(`  tutte le chiavi cliente: ${Object.keys(cliente).join(', ')}`);
    } catch (e) { log(`  cliente non leggibile: ${e.message}`); }
  }
} catch (e) { log(`ERRORE: ${e.message}`); }
log('FINE');
fs.mkdirSync(config.dataDir, { recursive: true });
fs.writeFileSync(path.join(config.dataDir, 'esito-provincia.txt'), `${righe.join('\n')}\n`);
