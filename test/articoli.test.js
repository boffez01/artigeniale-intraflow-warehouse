import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogo, conCodiciGiobby, righeDaScegliere, risolviArticoli } from '../src/articoli.js';

const cat = catalogo([
  { id: 'FAR-001', basicCode: '', description: 'Farina di riso integrale 1 kg' },
  { id: 'FAR-002', basicCode: 'FM-MAIS-1', description: 'Farina di mais 1 kg' },
  { id: 'FAR-003', basicCode: 'FM-SEMOLA-5', description: 'Semola di grano duro 5 kg' },
  { id: 'FAR-004', basicCode: 'DUP', description: 'Doppio A' },
  { id: 'FAR-005', basicCode: 'DUP', description: 'Doppio B' },
  { id: 'FAR-006', basicCode: '', description: 'Gemella' },
  { id: 'FAR-007', basicCode: '', description: 'gemella' },
]);
const r = (x) => risolviArticoli([x], cat)[0];

test('1) codice del fornitore = codice secondario (maiuscole e spazi ignorati)', () => {
  assert.deepEqual([r({ codice_articolo: ' fm-mais-1 ' }).id, r({ codice_articolo: ' fm-mais-1 ' }).metodo], ['FAR-002', 'codice']);
});
test('codice uguale al codice primario: accettato', () => {
  assert.equal(r({ codice_articolo: 'FAR-003' }).metodo, 'codice_primario');
});
test('2) codice sconosciuto o assente: descrizione identica e unica', () => {
  assert.equal(r({ codice_articolo: 'BOH', descrizione: 'FARINA  di mais 1 KG' }).id, 'FAR-002');
  assert.equal(r({ descrizione: 'Farina di riso integrale 1 kg' }).metodo, 'descrizione');
});
test('3) niente corrispondenza, o ambigua: da scegliere (mai a caso)', () => {
  assert.equal(r({ codice_articolo: 'BOH', descrizione: 'Farina di mais' }).stato, 'da_scegliere');
  assert.match(r({ codice_articolo: 'DUP' }).motivo, /più articoli/);
  assert.equal(r({ descrizione: 'gemella' }).stato, 'da_scegliere');
  assert.match(r({ quantita: 1, descrizione: 'x' }).motivo, /senza un codice|non ha un codice/);
});
test('la scelta dell\'operatore vince su tutto; se l\'articolo non esiste più torna da scegliere', () => {
  assert.equal(r({ codice_articolo: 'FM-MAIS-1', articolo_giobby: 'FAR-003' }).id, 'FAR-003');
  assert.equal(r({ articolo_giobby: 'FAR-999' }).stato, 'da_scegliere');
});
test('riga completamente vuota ignorata; messaggio e sostituzione dei codici', () => {
  const righe = [{ codice_articolo: 'FM-MAIS-1' }, { codice_articolo: 'BOH', descrizione: 'x' }, {}];
  const ris = risolviArticoli(righe, cat);
  assert.equal(ris[2].stato, 'vuota');
  assert.match(righeDaScegliere(righe, ris), /riga 2 \(BOH - x\)/);
  assert.equal(righeDaScegliere([righe[0]], [ris[0]]), null);
  assert.equal(conCodiciGiobby({ righe }, ris).righe[0].codice_articolo, 'FAR-002');
  assert.equal(conCodiciGiobby({ righe }, ris).righe[1].codice_articolo, 'BOH');
});