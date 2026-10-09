import test from 'node:test';
import assert from 'node:assert/strict';
import { check, chiaveDdt, normalize, normalizeDate, parseIso } from '../src/validation.js';
import { DdtSchema } from '../src/schemas.js';

const NOW = new Date(2026, 9, 5, 12, 0); // 5 ottobre 2026
const ddt = (riga = {}, extra = {}) =>
  normalize(DdtSchema.parse({
    fornitore: 'Forn Srl', partita_iva_fornitore: 'IT 01234567890', numero_ddt: '0123', data_ddt: '2026-10-01',
    numero_ordine_cliente: 'OC-1',
    righe: [{ codice_articolo: 'A1', quantita: 10, unita_misura: 'PZ', lotto: 'L42', data_scadenza: '2027-05-01', ...riga }],
    ...extra,
  }));
const errori = (d, o = {}) => check(d, { now: NOW, ...o }).errori.join(' | ');
const avvisi = (d, o = {}) => check(d, { now: NOW, ...o }).avvisi.join(' | ');

test('DDT valido: nessun errore', () => assert.deepEqual(check(ddt(), { now: NOW }).errori, []));

test('date: esistenti sul calendario (casi segnalati in revisione)', () => {
  assert.equal(parseIso('2026-02-31'), null);
  assert.equal(parseIso('2026-99-99'), null);
  assert.equal(parseIso('2027-02-29'), null);      // 2027 non bisestile
  assert.ok(parseIso('2028-02-29'));               // 2028 bisestile
  assert.equal(parseIso('1/5/2027'), null);
  assert.match(errori(ddt({ data_scadenza: '2026-02-31' })), /non valida/);
  assert.match(errori(ddt({}, { data_ddt: '2026-99-99' })), /Data DDT non valida/);
});

test('date italiane normalizzate in ISO', () => {
  assert.equal(normalizeDate('01/05/2027'), '2027-05-01');
  assert.equal(normalizeDate('1-5-27'), '2027-05-01');
  assert.equal(normalizeDate('01.05.2027'), '2027-05-01');
  assert.deepEqual(check(ddt({ data_scadenza: '01/05/2027' }), { now: NOW }).errori, []);
});

test('scadenza: delta giorni indipendente da fuso/ora del giorno', () => {
  assert.match(errori(ddt({ data_scadenza: '2026-10-04' })), /GIÀ SCADUTA/);
  for (const ora of [[0, 1], [12, 0], [23, 59]]) {
    const now = new Date(2026, 9, 5, ...ora);
    assert.deepEqual(check(ddt({ data_scadenza: '2026-10-05' }), { now }).errori, [], `scade oggi, ore ${ora}`);
    assert.match(check(ddt({ data_scadenza: '2026-10-04' }), { now }).errori.join(), /SCADUTA/);
    assert.match(check(ddt({ data_scadenza: '2026-11-04' }), { now }).avvisi.join(), /30 giorni/); // esattamente 30
    assert.doesNotMatch(check(ddt({ data_scadenza: '2026-11-05' }), { now }).avvisi.join(), /ravvicinata/); // 31
  }
  assert.match(avvisi(ddt({ data_scadenza: '2062-01-01' })), /oltre 10 anni/);
});

test('lotto: maiuscolo, niente spazi/simboli strani, obbligatorio', () => {
  assert.equal(ddt({ lotto: ' l42/a ' }).righe[0].lotto, 'L42/A');
  assert.match(errori(ddt({ lotto: 'L 42' })), /non valido/);
  assert.match(errori(ddt({ lotto: 'L42$' })), /non valido/);
  assert.match(errori(ddt({ lotto: 'X' })), /non valido/);
  assert.match(errori(ddt({ lotto: null })), /lotto mancante/);
});

test('quantità: decimale su PZ/CT è BLOCCANTE e non viene mai arrotondata', () => {
  assert.match(errori(ddt({ quantita: 2.5, unita_misura: 'PZ' })), /decimale/);
  assert.equal(ddt({ quantita: 2.5, unita_misura: 'PZ' }).righe[0].quantita, 2.5); // nessun round/floor
  assert.deepEqual(check(ddt({ quantita: 2.5, unita_misura: 'KG' }), { now: NOW }).errori, []);
  assert.match(errori(ddt({ quantita: 0 })), /quantità/);
  assert.match(errori(ddt({ quantita: null })), /quantità/);
});

test('chiave di idempotenza: P.IVA normalizzata, zeri iniziali, obbligatorietà', () => {
  const d = ddt();
  assert.equal(d.partita_iva_fornitore, '01234567890');
  assert.equal(d.numero_ddt, '123');
  assert.equal(chiaveDdt(d), '01234567890|123|2026-10-01');
  assert.equal(chiaveDdt(ddt({}, { partita_iva_fornitore: null, fornitore: 'Forn S.r.l.' })), 'FORNSRL|123|2026-10-01');
  assert.equal(chiaveDdt(ddt({}, { numero_ddt: null })), null);
  assert.match(errori(ddt({}, { numero_ddt: null })), /Numero DDT mancante/);
  assert.match(errori(ddt({}, { data_ddt: null })), /Data DDT mancante/);
  assert.match(errori(ddt({}, { fornitore: null, partita_iva_fornitore: null })), /Fornitore non identificato/);
});

test('duplicati: bloccante se stesso DDT, avviso se solo stesso numero+data', () => {
  assert.match(errori(ddt(), { duplicato: { id: 7, status: 'caricato' } }), /DUPLICATO.*#7/);
  assert.match(avvisi(ddt(), { simili: [{ id: 3 }] }), /#3/);
  assert.equal(check(ddt(), { now: NOW, simili: [{ id: 3 }] }).errori.length, 0);
});

test('ordine cliente mancante: solo AVVISO (non tutti i fornitori lo riportano)', () => {
  const d = ddt({}, { numero_ordine_cliente: '  ' });
  assert.equal(d.numero_ordine_cliente, null);
  assert.deepEqual(check(d, { now: NOW }).errori, []);
  assert.match(avvisi(d), /ordine cliente non trovato/);
});

test('righe duplicate', () => {
  const d = ddt({}, { righe: [
    { codice_articolo: 'A1', quantita: 1, lotto: 'L1', data_scadenza: '2027-05-01' },
    { codice_articolo: 'A1', quantita: 2, lotto: 'L1', data_scadenza: '2027-05-01' },
  ] });
  assert.match(avvisi(d), /stesso articolo e lotto/);
});

test('scadenza solo mese/anno -> ultimo giorno del mese + avviso', () => {
  const sc = (v) => ddt({ data_scadenza: v }).righe[0];
  assert.equal(sc('4/27').data_scadenza, '2027-04-30');
  assert.equal(sc('4/27').scadenza_a_fine_mese, true);
  assert.equal(sc('06/27').data_scadenza, '2027-06-30');
  assert.equal(sc('2027-04').data_scadenza, '2027-04-30');
  assert.equal(sc('2/28').data_scadenza, '2028-02-29');   // 2028 bisestile
  assert.equal(sc('2/29').data_scadenza, '2029-02-28');
  assert.equal(sc('2027-05-01').scadenza_a_fine_mese, false);
  assert.match(avvisi(ddt({ data_scadenza: '4/27' })), /solo mese\/anno.*ULTIMO giorno.*2027-04-30/);
  assert.deepEqual(check(ddt({ data_scadenza: '4/27' }), { now: NOW }).errori, []);
  // mese/anno già passato (DDT di febbraio con scadenza 08/2026): bloccato
  assert.match(errori(ddt({ data_scadenza: '08/2026' })), /GIÀ SCADUTA/);
});

test('scadenza ambigua o illeggibile: errore, nessuna invenzione', () => {
  assert.match(errori(ddt({ data_scadenza: '10/20/27' })), /non valida/); // lettura dubbia dal caso reale
  assert.match(errori(ddt({ data_scadenza: '13/27' })), /non valida/);    // mese 13
  assert.match(errori(ddt({ data_scadenza: null })), /scadenza mancante/);
});

test("la marcatura 'fine mese' resta se la data è invariata e cade se cambia", () => {
  const base = { data_scadenza: '2027-04-30', scadenza_a_fine_mese: true };
  assert.equal(ddt(base).righe[0].scadenza_a_fine_mese, true);
  assert.equal(ddt({ data_scadenza: '2027-04-30', scadenza_a_fine_mese: false }).righe[0].scadenza_a_fine_mese, false);
});

test('unità di misura normalizzata (KG. -> KG)', () => {
  assert.equal(ddt({ unita_misura: 'KG.' }).righe[0].unita_misura, 'KG');
  assert.equal(ddt({ unita_misura: ' pz ' }).righe[0].unita_misura, 'PZ');
});

test('P.IVA del fornitore uguale a quella di Artigeniale = errore di lettura', () => {
  assert.match(errori(ddt({}, { partita_iva_fornitore: 'IT01115770297' })), /uguale a quella di Artigeniale/);
  assert.deepEqual(check(ddt(), { now: NOW }).errori, []);
});