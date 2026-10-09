import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const D1 = iso(200), D2 = iso(260), DDT_DATA = iso(-4);

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-'));
const { config } = await import('../src/config.js');
const { extractor } = await import('../src/extractor.js');
const { createApp } = await import('../src/app.js');
const { DdtSchema } = await import('../src/schemas.js');
const db = await import('../src/db.js');

const ddtMock = (numero, extra = {}) => DdtSchema.parse({
  fornitore: 'Forn Srl', partita_iva_fornitore: '01234567890', cliente: 'Artigeniale srl',
  numero_ddt: numero, data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
  righe: [
    { codice_articolo: 'A1', descrizione: 'Pasta', quantita: 10, unita_misura: 'PZ', lotto: 'L42', data_scadenza: D1 },
    { codice_articolo: 'B2', descrizione: 'Olio', quantita: 5, unita_misura: 'PZ' },
  ],
  ...extra,
});
let mock = () => [ddtMock('123')]; // mock di Gemini: nessuna chiamata di rete
let chiamateGemini = 0;
let ritardo = 0; // simula i secondi di Gemini (serve per far correre due upload insieme)
extractor.extractDdt = async () => { chiamateGemini++; if (ritardo) await new Promise((r) => setTimeout(r, ritardo)); return mock(); };

const pdf = (tag) => new Blob([`%PDF-1.4\n${tag}\n%%EOF\n`], { type: 'application/pdf' });
const outbox = () => fs.readdirSync(config.outboxDir).filter((f) => f.startsWith('DRY-')).length;

// Quello che manderebbe il browser (campi come stringhe, data italiana, lotto minuscolo, P.IVA con IT)
const corpo = (numero, over = {}, overRiga1 = {}) => ({
  fornitore: 'Forn Srl', partita_iva_fornitore: 'IT01234567890', numero_ddt: numero,
  data_ddt: DDT_DATA, numero_ordine_cliente: 'OC-77',
  righe: [
    { codice_articolo: 'A1', quantita: '10', unita_misura: 'PZ', lotto: 'l42', data_scadenza: D1.split('-').reverse().join('/') },
    { codice_articolo: 'B2', quantita: '5', unita_misura: 'PZ', lotto: 'L9', data_scadenza: D2, ...overRiga1 },
  ],
  ...over,
});

test('API: blocchi, idempotenza, concorrenza, più DDT per file', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (url, method, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const upload = async (blob, name) => {
    const fd = new FormData(); fd.append('file', blob, name);
    return (await fetch(`${base}/api/upload`, { method: 'POST', body: fd })).json();
  };

  // 1) Upload: errori/avvisi calcolati dal server
  assert.deepEqual(await upload(pdf('A'), 'a.pdf'), { ids: [1], id: 1, duplicato: false });
  let d = (await json('/api/ddt/1', 'GET')).body;
  assert.equal(d.status, 'da_verificare');
  assert.ok(d.esito.errori.some((e) => /Riga 2: lotto mancante/.test(e)));
  assert.equal(d.file_type, 'pdf');
  assert.equal(d.pagina, 1);

  // 2) Richiesta "forzata" con lotto non valido: il server rivalida e BLOCCA
  let r = await json('/api/ddt/1/invia', 'POST', corpo('123', {}, { lotto: 'L 9' }));
  assert.equal(r.status, 422);
  assert.ok(r.body.esito.errori.some((e) => /non valido/.test(e)));
  assert.equal(outbox(), 0);

  // 3) Decimale su PZ: bloccato e NON arrotondato
  r = await json('/api/ddt/1/invia', 'POST', corpo('123', {}, { quantita: '5,5' }));
  assert.equal(r.status, 422);
  assert.equal(r.body.ddt.righe[1].quantita, 5.5);
  assert.equal(outbox(), 0);

  // 4) Payload malformato: nessun crash, nessun invio
  r = await json('/api/ddt/1/invia', 'POST', { righe: 'boom', fornitore: 42 });
  assert.equal(r.status, 422);
  assert.equal(outbox(), 0);

  // 5) Scadenza mese/anno scritta a mano + "KG." : normalizzate, con avviso; poi caricato
  r = await json('/api/ddt/1', 'PUT', corpo('123', {}, { data_scadenza: '4/37', unita_misura: 'KG.' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ddt.righe[1].data_scadenza, '2037-04-30');
  assert.equal(r.body.ddt.righe[1].scadenza_a_fine_mese, true);
  assert.equal(r.body.ddt.righe[1].unita_misura, 'KG');
  assert.ok(r.body.esito.avvisi.some((a) => /ULTIMO giorno del mese/.test(a)));
  assert.deepEqual(r.body.esito.errori, []);
  r = await json('/api/ddt/1/invia', 'POST', corpo('123'));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'caricato');
  assert.equal(outbox(), 1);
  const f = fs.readdirSync(config.outboxDir).find((x) => x.startsWith('DRY-'));
  const payload = JSON.parse(fs.readFileSync(path.join(config.outboxDir, f), 'utf8'));
  assert.equal(payload.righe[0].lotto, 'L42');
  assert.equal(payload.righe[0].data_scadenza, D1);
  assert.equal(payload.chiave, `01234567890|123|${DDT_DATA}`);

  // 6) Un DDT caricato non è più modificabile
  assert.equal((await json('/api/ddt/1', 'PUT', corpo('123'))).status, 409);

  // 7) Stessa scansione ricaricata: nessuna nuova riga
  assert.deepEqual(await upload(pdf('A'), 'a-bis.pdf'), { ids: [1], id: 1, duplicato: true });
  assert.equal(db.listAll().length, 1);

  // 8) Stesso DDT cartaceo ri-scansionato (byte diversi): nuova riga ma BLOCCATA come duplicato
  assert.deepEqual(await upload(pdf('B'), 'b.pdf'), { ids: [2], id: 2, duplicato: false });
  d = (await json('/api/ddt/2', 'GET')).body;
  assert.ok(d.esito.errori.some((e) => /DUPLICATO.*#1/.test(e)));
  r = await json('/api/ddt/2/invia', 'POST', corpo('123'));
  assert.equal(r.status, 422);
  assert.equal(outbox(), 1, 'nessun secondo carico');
  assert.equal(db.claimInvio(2, `01234567890|123|${DDT_DATA}`), false, "l'indice univoco del DB lo impedisce comunque");

  // 9) Scarto del duplicato
  assert.equal((await json('/api/ddt/2/scarta', 'POST')).body.status, 'scartato');
  assert.equal((await json('/api/ddt/1/scarta', 'POST')).status, 409);

  // 10) Due conferme CONCORRENTI dello stesso DDT: parte un solo carico
  mock = () => [ddtMock('124')];
  await upload(pdf('C'), 'c.pdf'); // id 3
  const [x, y] = await Promise.all([json('/api/ddt/3/invia', 'POST', corpo('124')), json('/api/ddt/3/invia', 'POST', corpo('124'))]);
  assert.equal(db.get(3).status, 'caricato');
  assert.equal(outbox(), 2, 'esattamente un carico in più, non due');
  const codici = [x.status, y.status].sort();
  assert.equal(codici[0], 200, 'una sola richiesta ha caricato');
  assert.ok([409, 422].includes(codici[1]));

  // 11) UN PDF CON PIÙ DDT: una scheda ciascuno, con la pagina giusta
  mock = () => [ddtMock('200', { pagina_inizio: 1 }), ddtMock('201', { pagina_inizio: 3 }), ddtMock('202', { pagina_inizio: 4 })];
  const multi = await upload(pdf('D'), 'sette.pdf');
  assert.deepEqual(multi, { ids: [4, 5, 6], id: 4, duplicato: false });
  const schede = await Promise.all([4, 5, 6].map(async (i) => (await json(`/api/ddt/${i}`, 'GET')).body));
  assert.deepEqual(schede.map((s) => s.pagina), [1, 3, 4]);
  assert.deepEqual(schede.map((s) => s.ddt.numero_ddt), ['200', '201', '202']);
  assert.match(schede[1].filename, /sette\.pdf \(DDT 2\/3\)/);
  assert.equal(new Set(schede.map((s) => db.get(s.id).stored_path)).size, 1, 'un solo file archiviato');
  // ricaricato lo stesso PDF: nessuna nuova scheda, ritorna le stesse
  assert.deepEqual(await upload(pdf('D'), 'sette-bis.pdf'), { ids: [4, 5, 6], id: 4, duplicato: true });
  assert.equal(db.listAll().length, 6);

  // 12) PDF senza DDT riconoscibili: una scheda in errore, non un crash
  mock = () => [];
  const vuoto = await upload(pdf('E'), 'vuoto.pdf');
  assert.equal(vuoto.ids.length, 1);
  d = (await json(`/api/ddt/${vuoto.id}`, 'GET')).body;
  assert.equal(d.status, 'errore');
  assert.match(d.error, /Nessun DDT riconosciuto/);

  // 13) Ogni scheda indica gli altri DDT dello stesso file (e un DDT singolo non ne ha)
  assert.deepEqual(schede[0].altri_ddt_del_file.map((a) => [a.id, a.pagina]), [[5, 3], [6, 4]]);
  assert.deepEqual(schede[2].altri_ddt_del_file.map((a) => a.id), [4, 5]);
  assert.deepEqual((await json('/api/ddt/1', 'GET')).body.altri_ddt_del_file, []);

  // 14) Due upload IDENTICI e CONTEMPORANEI di un PDF con 3 DDT: restano 3 schede, non 6
  mock = () => [ddtMock('300'), ddtMock('301'), ddtMock('302')];
  ritardo = 150;
  const prima = db.listAll().length;
  const chiamatePrima = chiamateGemini;
  const [u1, u2] = await Promise.all([upload(pdf('F'), 'f1.pdf'), upload(pdf('F'), 'f2.pdf')]);
  ritardo = 0;
  assert.equal(chiamateGemini - chiamatePrima, 2, 'la corsa è reale: entrambi sono arrivati a Gemini prima di inserire');
  assert.equal(db.listAll().length, prima + 3, 'nessuna scheda a metà né doppia');
  assert.notEqual(u1.duplicato, u2.duplicato, 'uno vince, l\'altro è riconosciuto come già acquisito');
  assert.deepEqual(u1.ids, u2.ids);
  assert.equal(fs.readdirSync(config.archiveDir).filter((f) => f.startsWith('f1_') || f.startsWith('f2_')).length <= 2, true);

  // 15) I dubbi di lettura sopravvivono al salvataggio finché l'utente non tocca il campo
  const idc = u1.ids[1];
  r = await json(`/api/ddt/${idc}`, 'PUT', corpo('301', {}, { campi_incerti: ['data_scadenza'] }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.ddt.righe[1].campi_incerti, ['data_scadenza']);
  assert.ok(r.body.esito.avvisi.some((a) => /incertezza.*data_scadenza/.test(a)));

  // 16) 404 in JSON
  assert.equal((await json('/api/ddt/999', 'GET')).status, 404);
});