// Scarica il PDF di un DDT di uscita da Giobby in data/ddt-<id>.pdf.   node scripts/ddt-pdf.js [idDDT]  (senza id: l'ultimo DDT non cancellato)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { ApiGiobby } from '../src/giobby.js';
import { GiobbyHttp } from '../src/giobbyHttp.js';
const g = new GiobbyHttp(); await g.login();
let id = process.argv[2];
if (!id) id = ((await g.get('/sales/goodsissue')).documentsHeaders ?? []).filter((d) => d.docStatusDesc !== 'Cancellato').sort((a, b) => b.id - a.id)[0]?.id;
if (!id) { console.log('Nessun DDT di uscita.'); process.exit(1); }
const pdf = await new ApiGiobby(g).pdfDdtUscita(id);
const file = path.join(config.dataDir, `ddt-${id}.pdf`);
fs.writeFileSync(file, pdf);
fs.writeFileSync(path.join(config.dataDir, 'esito-pdf.txt'), `OK: DDT ${id}, ${pdf.length} byte -> ${file}\n`);
console.log(`✔ PDF del DDT ${id} salvato: ${file} (${pdf.length} byte)`);
