// Cerca nelle API di Giobby un modo per scaricare il PDF di un DDT di uscita. SOLO LETTURE (GET). Esito in data/esito-pdf.txt
//   node scripts/giobby-pdf-cerca.js [idDDT]     (senza id usa l'ultimo DDT di uscita)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';

const FILE = path.join(config.dataDir, 'esito-pdf.txt');
fs.writeFileSync(FILE, `Ricerca PDF ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };

const g = new GiobbyHttp(); await g.login();
let id = process.argv[2];
if (!id) {
  const r = await g.get('/sales/goodsissue');
  const doc = (r.documentsHeaders ?? []).filter((d) => d.docStatus !== 'CANCELLED' && d.docStatusDesc !== 'Cancellato').sort((a, b) => b.id - a.id)[0];
  if (!doc) { log('✖ Nessun DDT di uscita: emettine uno dalla pagina Picking.'); process.exit(1); }
  id = doc.id;
}
const { document: d } = await g.get(`/sales/${id}/goodsissue`);
log(`DDT ${id}: ${d.docDescription}, stato ${d.docStatusDesc}, modello di stampa: "${d.idLastUsedPrintTemplate}"`);

const s = g.sessione;
const tentativi = [
  `/sales/${id}/goodsissue/pdf`, `/sales/${id}/goodsissue/print`, `/sales/${id}/goodsissue/report`, `/sales/${id}/goodsissue/download`,
  `/sales/${id}/pdf`, `/sales/${id}/print`, `/sales/${id}/goodsissue?format=pdf`, `/sales/${id}/goodsissue?print=true`,
  `/documents/${id}/pdf`, `/documents/${id}/print`, `/documents/${id}`, `/print/${id}`, `/print/sales/${id}/goodsissue`,
  '/printtemplates', '/print/templates', '/documents/printtemplates', '/sales/printtemplates',
];
for (const p of tentativi) {
  for (const accept of ['application/json', 'application/pdf']) {
    try {
      const res = await fetch(`${s.apiUrl}${p}`, { headers: { Accept: accept, Authorization: `Bearer ${s.accessToken}`, 'X-Giobby-Realm': config.giobbyRealm } });
      const tipo = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      const inizio = buf.subarray(0, 120).toString('latin1').replace(/\s+/g, ' ');
      log(`${res.status} ${accept.split('/')[1].padEnd(4)} ${p}  [${tipo}] ${buf.length}B ${res.ok ? inizio : ''}`);
      if (res.ok && buf.subarray(0, 4).toString() === '%PDF') { fs.writeFileSync(path.join(config.dataDir, 'ddt-giobby.pdf'), buf); log('   ✔ È UN PDF: salvato in data/ddt-giobby.pdf'); }
    } catch (e) { log(`ERR ${p}: ${e.message}`); }
  }
}
log('FINE');
