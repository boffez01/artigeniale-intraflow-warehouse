// Prepara il sandbox per la demo: 3 clienti e 5 ordini di vendita da evadere (date di consegna e articoli diversi).
// Solo sandbox ("sb-"). Esito in data/esito-demo-ordini.txt.   node scripts/demo-ordini.js
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { dataGiobby, oggiIso } from '../src/giobbyCarico.js';

const FILE = path.join(config.dataDir, 'esito-demo-ordini.txt');
fs.writeFileSync(FILE, `Demo ${new Date().toISOString()}\n`);
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(FILE, `${t}\n`); };
if (!/^sb-/i.test(config.giobbyCid || '')) { log('✖ Non è un sandbox: mi fermo.'); process.exit(1); }

const traGiorni = (n) => { const d = new Date(`${oggiIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const CLIENTI = [
  { id: 'DEMO_ROSSI', nome: 'Panificio Rossi', citta: 'Monza', pr: 'MB' },
  { id: 'DEMO_BIANCHI', nome: 'Pasta Bianchi', citta: 'Milano', pr: 'MI' },
  { id: 'DEMO_VERDI', nome: 'Ristorante Verdi', citta: 'Como', pr: 'CO' },
];
const ORDINI = [
  ['DEMO_ROSSI', 1, [['FAR-002', 40], ['FAR-003', 15]]],
  ['DEMO_ROSSI', 4, [['FAR-002', 60]]],
  ['DEMO_BIANCHI', 2, [['FAR-003', 25], ['FAR-002', 30]]],
  ['DEMO_VERDI', 3, [['FAR-002', 20]]],
  ['DEMO_VERDI', 6, [['FAR-003', 10]]],
];

const g = new GiobbyHttp(); await g.login();
try {
  let esistenti = (await g.get('/customers')).customers ?? [];
  for (const c of CLIENTI) {
    if (esistenti.some((x) => x.id === c.id)) { log(`Cliente ${c.nome}: già presente`); continue; }
    await g.post('/customers', {
      contact: { type: 'COMPANY', name: c.nome, lastName: '', address: 'Via Demo 1', city: c.citta, country: 'IT', state: '', postalCode: '20900', pr: c.pr, fiscalCode: '', vatCode: '', phone1: '', phone2: '', mobile: '', fax: '', email: '', email2: '', visibilityType: 'ALL', status: 'AL', source: 'Demo', note: 'Demo picking' },
      id: c.id, currency: 'EUR', credit: '0', dsc1: '0', dsc2: '0', dsc3: '0', dsc4: '0', priceListEnabled: false, locked: false,
    });
    log(`Cliente ${c.nome}: creato`);
  }
  esistenti = (await g.get('/customers')).customers ?? [];
  const contatto = Object.fromEntries(esistenti.map((x) => [x.id, x.contact.id]));

  for (const [cliente, giorni, righe] of ORDINI) {
    if (!contatto[cliente]) { log(`✖ ${cliente}: contatto non trovato`); continue; }
    const consegna = traGiorni(giorni);
    const corpo = {
      idDocumentType: 0, idDocumentTypeExt: '0', idOrderType: '1', idContact: String(contatto[cliente]), idCustomer: cliente,
      docDate: String(dataGiobby(oggiIso())), docStatus: 'CREATED', docCurrency: 'EUR', idBu: 'U1', idNumerator: '1', internalNote: 'DEMO PICKING',
      rows: righe.map(([articolo, q]) => ({ idMaterial: articolo, idAttributeCombination: 0, idPosType: '1', price: '10', quantity: String(q), packages: String(q), dsc1: 0, dsc2: 0, dsc3: 0, dsc4: 0, idVat: '22', description: articolo, deliveryDate: String(dataGiobby(consegna)), idStorage: 'MB', withholdingTax: false })),
    };
    const r = await g.post('/sales/orders', corpo);
    log(`Ordine ${cliente} consegna ${consegna}: ${righe.map(([a, q]) => `${a} ${q}`).join(', ')} -> id ${r.idDocument ?? JSON.stringify(r).slice(0, 80)}`);
  }
  log('FATTO. Nella pagina Picking premi "Rileggi da Giobby".');
} catch (e) {
  log(`✖ ${e instanceof GiobbyError ? e.message : e} ${e.dettaglio ? JSON.stringify(e.dettaglio).slice(0, 600) : ''}`);
}
