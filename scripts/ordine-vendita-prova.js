// Crea 2 ordini di vendita di PROVA sul sandbox Giobby (cliente CLI_DEFAULT), per far girare il picking su dati veri.
//
//   node scripts/ordine-vendita-prova.js            -> SIMULAZIONE: Giobby controlla il corpo e risponde, ma non salva niente
//   node scripts/ordine-vendita-prova.js --vero     -> li crea davvero (solo se il cid è un sandbox "sb-...")
//
// Ogni ordine porta "PROVA PICKING" nei riferimenti interni, così si riconoscono e si possono cancellare a mano.
import { config } from '../src/config.js';
import { GiobbyError, GiobbyHttp } from '../src/giobbyHttp.js';
import { dataGiobby, oggiIso } from '../src/giobbyCarico.js';

const vero = process.argv.includes('--vero');
if (!/^sb-/i.test(config.giobbyCid || '')) {
  console.error('✖ Questo account non sembra un sandbox (il cid non inizia con "sb-"): non scrivo ordini di prova.');
  process.exit(1);
}

const traGiorni = (n) => {
  const d = new Date(`${oggiIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const riga = (articolo, quantita, consegna) => ({
  idMaterial: articolo,
  idAttributeCombination: 0,
  idPosType: '1',
  price: '10',
  quantity: String(quantita),
  packages: String(quantita),
  dsc1: 0, dsc2: 0, dsc3: 0, dsc4: 0,
  idVat: '22',
  description: articolo,
  deliveryDate: String(dataGiobby(consegna)),
  idStorage: 'MB',
  withholdingTax: false,
});

const ordine = (consegna, righe, nota) => ({
  idDocumentType: 0,
  idDocumentTypeExt: '0',
  idOrderType: '1',
  idContact: '2',
  idCustomer: 'CLI_DEFAULT',
  docDate: String(dataGiobby(oggiIso())),
  docStatus: 'CREATED',
  docCurrency: 'EUR',
  idBu: 'U1',
  idNumerator: '1',
  internalNote: `PROVA PICKING ${nota}`,
  rows: righe.map(([articolo, quantita]) => riga(articolo, quantita, consegna)),
});

const ordini = [
  ordine(traGiorni(2), [['FAR-002', 50], ['FAR-003', 10]], 'A'),
  ordine(traGiorni(1), [['FAR-002', 30]], 'B'),
];

const g = new GiobbyHttp();
try {
  await g.login();
  console.log(`✔ Login riuscito (cid ${config.giobbyCid}). Modo: ${vero ? 'VERO (crea gli ordini)' : 'SIMULAZIONE (non salva niente)'}`);
  for (const corpo of ordini) {
    const r = await g.richiesta('POST', `/sales/orders${vero ? '' : '?simulation=true'}`, { body: corpo });
    console.log(`\n${corpo.internalNote}:`);
    console.log(JSON.stringify(r, null, 2).slice(0, 1500));
  }
  if (!vero) console.log('\nSimulazione finita. Se le risposte sono senza errori, rilancia con --vero.');
} catch (e) {
  console.error(`✖ ${e instanceof GiobbyError ? e.message : e}`);
  if (e instanceof GiobbyError && e.dettaglio) console.error(JSON.stringify(e.dettaglio, null, 2).slice(0, 2500));
  process.exit(1);
}