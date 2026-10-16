// Cerca in Giobby gli endpoint di giacenze, magazzini e vendite. SOLO LETTURE (GET): non modifica nulla.
//   node scripts/giobby-cerca.js
// Per ogni percorso stampa: OK (con i campi e quanti elementi ci sono) oppure il motivo del rifiuto.
// Non cerca di essere completo: serve a capire QUALI nomi esistono, poi si guarda il dettaglio con giobby-test.js.
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';

const PERCORSI = [
  '/sales/orders', '/sales/goodsissue', '/sales/deliverynotes', '/sales/ddt', '/sales/documents', '/sales/invoices',
  '/customers', '/clients',
  '/stock', '/stocks', '/stocklevels', '/stockqty', '/inventory', '/inventories', '/stockmovements', '/movements',
  '/warehouses', '/warehouse', '/storages', '/storagelocations', '/locations',
  '/lots/stock', '/products/stock', '/products/FAR-002/stock', '/products/FAR-002/lots',
];

const g = new GiobbyHttp();
try {
  await g.login();
  console.log(`✔ Login riuscito (cid ${config.giobbyCid}). Provo ${PERCORSI.length} percorsi, solo lettura.\n`);
} catch (e) {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  process.exit(1);
}

const riassunto = (r) => {
  const campi = Object.keys(r ?? {}).filter((k) => !['responseCode', 'errorCode', 'developerMessage', 'userMessage', 'concatWarningMessages'].includes(k));
  return campi.map((k) => (Array.isArray(r[k]) ? `${k}[${r[k].length}]` : k)).join(', ') || '(vuoto)';
};

for (const p of PERCORSI) {
  try {
    const r = await g.get(p);
    console.log(`OK    ${p.padEnd(26)} ${riassunto(r)}`);
  } catch (e) {
    const msg = e instanceof GiobbyError ? `${e.status ?? ''} ${e.message}` : String(e);
    console.log(`no    ${p.padEnd(26)} ${msg.replace(/\s+/g, ' ').slice(0, 90)}`);
  }
}