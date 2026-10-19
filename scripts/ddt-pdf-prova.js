// Prova le varianti dell'endpoint PDF dei DDT di uscita. Solo letture. Esito in data/esito-pdf-prova.txt
//   node scripts/ddt-pdf-prova.js [idDDT]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';
const FILE = path.join(config.dataDir, 'esito-pdf-prova.txt');
fs.writeFileSync(FILE, `Prova PDF ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };
const g = new GiobbyHttp(); await g.login();
let id = process.argv[2];
if (!id) id = ((await g.get('/sales/goodsissue')).documentsHeaders ?? []).filter((d) => d.docStatusDesc !== 'Cancellato').sort((a, b) => b.id - a.id)[0]?.id;
log(`DDT ${id}`);
const s = g.sessione;
const percorsi = [
  `/sales/goodsissue/${id}/pdf`, `/sales/goodsissue/${id}/pdf?idDocType=1`, `/sales/goodsissue/${id}/pdf?idDocType=1&idPrintTemplate=1`,
  `/sales/goodsissue/${id}/pdf?idDocType=1&idPrintTemplate=0`, `/sales/goodsissue/${id}/pdf?idPrintTemplate=1`,
  `/sales/${id}/pdf`, `/sales/${id}/pdf?idDocType=1`, `/sales/${id}/pdf?idDocType=1&idPrintTemplate=1`,
];
for (const p of percorsi) for (const accept of ['application/pdf', '*/*', 'application/json']) {
  const res = await fetch(`${s.apiUrl}${p}`, { headers: { Accept: accept, Authorization: `Bearer ${s.accessToken}`, 'X-Giobby-Realm': config.giobbyRealm } });
  const buf = Buffer.from(await res.arrayBuffer());
  const pdf = buf.subarray(0, 4).toString() === '%PDF';
  log(`${res.status} ${accept.padEnd(16)} ${p} [${res.headers.get('content-type') || ''}] ${buf.length}B ${pdf ? 'PDF!' : buf.subarray(0, 160).toString('utf8').replace(/\s+/g, ' ')}`);
  if (pdf) { fs.writeFileSync(path.join(config.dataDir, `ddt-${id}.pdf`), buf); log('   ✔ salvato in data/ddt-' + id + '.pdf'); }
}
log('FINE');
