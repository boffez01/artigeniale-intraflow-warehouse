import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-arch-'));
const { extractor } = await import('../src/extractor.js');
const { createApp, filtri } = await import('../src/app.js');
const { DdtSchema } = await import('../src/schemas.js');
const ddt = (fornitore, numero, data, lotto) => DdtSchema.parse({
  fornitore, partita_iva_fornitore: '01234567890', numero_ddt: numero, data_ddt: data, numero_ordine_cliente: 'OC-1',
  righe: [{ codice_articolo: 'ART-9', descrizione: 'Farina di riso', quantita: 10, unita_misura: 'KG', lotto, data_scadenza: '2099-01-31' }],
});

const coda = [
  ddt('Alfa Srl', '10', '2026-02-10', 'LOTTOALFA1'),
  ddt('Beta Spa', '20', '2026-02-15', 'BETA-22'),
  ddt('Beta Spa', '21', '2026-02-20', 'BETA-23'),
  ddt('=SOMMA(1)', '30', '2026-03-01', 'GAMMA-1'), // nome fornitore "pericoloso" per Excel
];
extractor.extractDdt = async () => [coda.shift()];

test('archivio: ricerca, filtri, ordinamento, paginazione, contatori, CSV', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (url) => (await fetch(base + url)).json();
  const upload = async (tag) => {
    const fd = new FormData();
    fd.append('file', new Blob([`%PDF-1.4\n${tag}\n%%EOF\n`], { type: 'application/pdf' }), `${tag}.pdf`);
    return (await fetch(`${base}/api/upload`, { method: 'POST', body: fd })).json();
  };
  for (const tag of ['a', 'b', 'c', 'd']) await upload(tag);

  // lista base: righe, controlli, fornitori e contatori letti dal DB
  let r = await get('/api/ddt');
  assert.equal(r.total, 4);
  assert.equal(r.items.length, 4);
  assert.equal(r.items[0].id, 4, 'default: più recente per primo');
  assert.equal(r.items[0].n_righe, 1);
  assert.equal(typeof r.items[0].n_errori, 'number');
  assert.deepEqual(r.counts.per_stato, { da_verificare: 4 });
  assert.equal(r.counts.totale, 4);
  assert.equal(r.counts.oggi, 4);
  assert.deepEqual(r.fornitori, ['=SOMMA(1)', 'Alfa Srl', 'Beta Spa']);

  // ricerca: fornitore, lotto (tracciabilità), codice articolo, numero DDT, "#id"
  assert.deepEqual((await get('/api/ddt?q=alfa')).items.map((x) => x.id), [1]);
  assert.deepEqual((await get('/api/ddt?q=BETA-23')).items.map((x) => x.id), [3]);
  assert.equal((await get('/api/ddt?q=ART-9')).total, 4);
  assert.deepEqual((await get('/api/ddt?q=%232')).items.map((x) => x.id), [2], '"#2" = scheda numero 2');
  assert.equal((await get('/api/ddt?q=%25')).total, 0, '"%" è cercato come carattere, non come jolly');
  assert.equal((await get("/api/ddt?q=' OR 1=1 --")).total, 0, 'niente SQL injection');

  // filtri: fornitore, date, stato (dopo aver scartato il #3)
  assert.equal((await get('/api/ddt?fornitore=Beta%20Spa')).total, 2);
  assert.deepEqual((await get('/api/ddt?da=2026-02-12&a=2026-02-28&sort=data&dir=asc')).items.map((x) => x.id), [2, 3]);
  assert.equal((await fetch(`${base}/api/ddt/3/scarta`, { method: 'POST' })).status, 200);
  r = await get('/api/ddt?stato=scartato');
  assert.deepEqual(r.items.map((x) => x.id), [3]);
  assert.deepEqual(r.counts.per_stato, { da_verificare: 3, scartato: 1 });
  assert.equal((await get('/api/ddt?stato=da_verificare,scartato')).total, 4);
  assert.equal((await get('/api/ddt?stato=inventato')).total, 4, 'stato sconosciuto ignorato');
  assert.equal(r.counts.oggi, 3, 'gli scartati non contano come acquisiti oggi');

  // ordinamento + paginazione
  r = await get('/api/ddt?sort=fornitore&dir=asc');
  assert.equal(r.items[0].fornitore, '=SOMMA(1)');
  r = await get('/api/ddt?sort=id&dir=asc&limit=2&offset=2');
  assert.deepEqual(r.items.map((x) => x.id), [3, 4]);
  assert.equal(r.total, 4);
  assert.equal(r.limit, 2);
  r = await get('/api/ddt?sort=id;DROP TABLE ddt&limit=9999&offset=-5');
  assert.equal(r.total, 4, 'sort non in whitelist: ordinamento di default, la tabella è intatta');
  assert.equal(r.limit, 100, 'limit massimo 100');
  assert.equal(r.offset, 0);

  // CSV: BOM, separatore ;, filtri rispettati, formula neutralizzata
  const res = await fetch(`${base}/api/ddt.csv?stato=da_verificare&sort=id&dir=asc`);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="ddt_\d{4}-\d{2}-\d{2}\.csv"/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8: Excel legge bene le accentate');
  const csv = buf.toString('utf8').replace(/^\uFEFF/, '');
  assert.ok(csv.startsWith('ID;Data DDT;N° DDT;Fornitore'));
  const righe = csv.trim().split('\r\n');
  assert.equal(righe.length, 1 + 3, 'intestazione + 3 DDT da verificare (il #3 è scartato)');
  assert.ok(righe[1].startsWith('1;2026-02-10;10;Alfa Srl;OC-1;1;da_verificare;'));
  assert.ok(righe[3].includes(";'=SOMMA(1);"), 'un valore che inizia con = non viene eseguito da Excel');

  // info di sistema: nessun segreto
  const info = await get('/api/info');
  assert.equal(info.giobby_mode, 'dryrun');
  assert.equal(typeof info.gemini_pronto, 'boolean');
  assert.ok(!JSON.stringify(info).includes('KEY'));
});

test('filtri(): input del browser sempre ripulito', () => {
  const f = filtri({ q: '  abc  ', stato: 'caricato,boh,errore', da: '2026-1-1', a: '2026-02-03', dir: 'asc', limit: 'x', offset: '7', sort: ['a', 'b'], fornitore: ['x'] });
  assert.deepEqual(f, { q: 'abc', stati: ['caricato', 'errore'], fornitore: '', da: '', a: '2026-02-03', sort: '', dir: 'asc', limit: 25, offset: 7 });
  assert.equal(filtri({ dir: 'DROP' }).dir, 'desc');
});