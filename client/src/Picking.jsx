import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';
import { Spiega } from './Tag.jsx';

// Esempio per la "modalità prova": si può scrivere a mano per vedere come ragiona il picking senza toccare Giobby.
const ESEMPIO = {
  ordini: [
    { id: 'OV-101', cliente: 'Panificio Rossi', stato: 'Creato', consegna: '2026-10-15', righe: [{ articolo: 'FAR-002', descrizione: 'Farina di mais 1 kg', quantita: 50 }, { articolo: 'FAR-003', descrizione: 'Semola 1 kg', quantita: 10 }] },
    { id: 'OV-102', cliente: 'Pasta Bianchi', stato: 'Creato', consegna: '2026-10-14', righe: [{ articolo: 'FAR-002', descrizione: 'Farina di mais 1 kg', quantita: 30 }] },
  ],
  giacenze: [
    { articolo: 'FAR-002', lotto: 'L2612A', scadenza: '2027-12-31', ubicazione: 'A-01-02', disponibile: 40 },
    { articolo: 'FAR-002', lotto: 'L2612C', scadenza: '2027-03-31', ubicazione: 'B-02-01', disponibile: 25 },
    { articolo: 'FAR-003', lotto: 'L2612B', scadenza: '2028-06-30', ubicazione: 'A-01-10', disponibile: 20 },
  ],
};

const STATO = {
  completo: ['ok', 'Completo'],
  parziale: ['warn', 'Parziale'],
  non_evadibile: ['err', 'Non evadibile'],
};

// Spiegazioni in parole semplici (compaiono passando il mouse), come nel Modulo A.
const SPIEGA_STATO = {
  completo: 'In magazzino c\'è tutta la merce dell\'ordine: puoi preparare e spedire tutto.',
  parziale: 'La merce in magazzino non basta per tutto l\'ordine. Il foglio indica cosa si può preparare e sotto cosa manca.',
  non_evadibile: 'Non c\'è merce disponibile per questo ordine (esaurita o scaduta). Non c\'è niente da preparare.',
};
const SP = {
  cliente: ['Cliente', 'Mostra solo gli ordini di un cliente. Con «Tutti» il foglio contiene tutti i clienti: un foglio a cliente, con gli ordini dello stesso cliente insieme.'],
  stato: ['Stato ordine', 'Lo stato dell\'ordine in Giobby: «Creato» = ancora da spedire, «Merce parzialmente spedita» = spedito solo in parte.'],
  dal: ['Consegna dal', 'Solo gli ordini con data di consegna da questo giorno in poi. Lascia vuoto per non limitare.'],
  al: ['Consegna al', 'Solo gli ordini con data di consegna fino a questo giorno. Lascia vuoto per non limitare.'],
  crea: ['Crea stampa picking', 'Calcola da quali lotti prendere la merce (prima quelli che scadono prima) per gli ordini filtrati e prepara i fogli da stampare. Non modifica nulla in Giobby.'],
  rileggi: ['Rileggi da Giobby', 'Rilegge ordini e giacenze aggiornati da Giobby. Usalo se sono arrivati nuovi ordini o la merce è cambiata.'],
  tablet: ['Modalità tablet', 'Ingrandisce pulsanti, campi e testo per usare il programma con le dita su tablet.'],
  storico: ['Storico DDT in uscita', 'Per ogni DDT emesso: cosa prevedeva il picking e cosa è finito davvero nel DDT (le differenze segnate dall\'operatore).'],
  stampaFoglio: ['Stampa questo foglio', 'Passo 1: stampa il foglio di questo cliente e portalo all\'operatore. Solo dopo che ha preparato la merce (passo 2) si crea il DDT qui sotto.'],
  stampa: ['Stampa', 'Stampa i fogli di picking per l\'operatore (uno per cliente). Menu e pulsanti non vengono stampati.'],
  prova: ['Modalità prova', 'Serve per provare il calcolo con ordini e giacenze scritti a mano, senza toccare Giobby. Per l\'uso normale ignorala.'],
  conferma: ['Conferma e crea DDT', 'Usa quando l\'operatore ha preparato tutto esattamente come scritto sul foglio. Giobby crea il DDT con questi lotti e scarica il magazzino.'],
  modifica: ['Modifica le quantità', 'Usa quando l\'operatore ha annotato differenze (ne ha preparato meno, o è mancato qualcosa). Nella tabella scegli i lotti (solo quelli esistenti in Giobby), scrivi le quantità vere e, se un lotto non basta, aggiungi un altro lotto con «+»: poi crei il DDT.'],
  ddt: ['Crea DDT in uscita', 'Per il back office, dopo che l\'operatore ha preparato la merce: correggi le quantità secondo le sue note e premi. Giobby crea il DDT collegato all\'ordine, con i lotti, e scarica il magazzino. Poi l\'operatore lo completa in Giobby (vettore, ecc.) e lo stampa.'],
  piu: ['Aggiungi un altro lotto', 'Se un lotto non basta per arrivare alla quantità richiesta, aggiunge una riga con il lotto a scadenza più vicina tra quelli non ancora usati, già con la quantità che manca. Puoi cambiare lotto e quantità.'],
  multi: ['Più lotti', 'Questo articolo si prende da più lotti: attenzione a non mescolarli, perché il DDT riporta ogni lotto.'],
};
const COL = {
  Articolo: 'Il codice e la descrizione dell\'articolo da preparare.',
  Lotto: 'Il lotto da cui prendere la merce: è quello che scade per primo.',
  Scadenza: 'Data di scadenza del lotto.',
  Ubicazione: 'Dove si trova la merce in magazzino (se indicata in Giobby).',
  'Q.tà': 'Nella riga dell\'articolo: quantità richiesta dall\'ordine. Nelle righe dei lotti: quanta ne prendi da quel lotto. Se non coincidono compare «/ richiesta».',
  'Preparato / differenze': 'Spazio per l\'operatore: scrive a penna cosa ha preparato davvero e le differenze (mancanze, lotti diversi).',
  Giacenza: 'Quanti ce ne sono in magazzino: nella riga del lotto la giacenza di quel lotto, nella riga dell\'articolo il totale di tutti i lotti.',
};
// Riquadro colore per riconoscere a colpo d'occhio articoli simili (es. base e premium). Il colore dipende solo dal codice articolo:
// lo stesso articolo ha sempre lo stesso colore. Quando Giobby avrà immagini o colori per articolo si useranno quelli.
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const coloreArticolo = (codice) => {
  let h = 0;
  for (const c of String(codice || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const Riquadro = ({ articolo }) => <Spiega titolo="Colore articolo" testo={`Il riquadro colorato identifica l'articolo ${articolo}: articoli simili (es. base e premium) hanno colori diversi, così non li scambi in magazzino.`}><span className="riquadro" style={{ background: coloreArticolo(articolo) }} /></Spiega>;
const Th = ({ nome, className }) => <th className={className}><Spiega titolo={nome} testo={COL[nome]}>{nome}</Spiega></th>;
const Etichetta = ({ chiave, children }) => <Spiega titolo={SP[chiave][0]} testo={SP[chiave][1]}>{children}</Spiega>;

const UM_DEC = /^(KG|KGM|G|GR|L|LT|ML|M|MT|MQ|CM)$/i;
const unici = (lista) => [...new Set(lista.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'it'));

export default function Picking() {
  const [dati, setDati] = useState(null); // { ordini, giacenze } letti da Giobby (o di prova)
  const [fonte, setFonte] = useState(null); // 'giobby' | 'prova'
  const [caricamento, setCaricamento] = useState(true);
  const [err, setErr] = useState('');
  const [cliente, setCliente] = useState('');
  const [stato, setStato] = useState('');
  const [da, setDa] = useState('');
  const [a, setA] = useState('');
  const [esito, setEsito] = useState(null);
  const [busy, setBusy] = useState(false);
  const [righeOrd, setRigheOrd] = useState({}); // ordine -> righe lotto [{ articolo, lotto, scadenza, ubicazione, quantita }] (modificabili)
  const [avvisi, setAvvisi] = useState({}); // ordine -> messaggio per l'operatore
  const [stampati, setStampati] = useState(() => new Set()); // clienti di cui il foglio è stato stampato
  const [inModifica, setInModifica] = useState(() => new Set()); // ordini di cui il back office sta correggendo le quantità
  const [riepilogo, setRiepilogo] = useState(null); // ordine di cui si sta controllando il riepilogo prima del DDT
  const [parzialeOk, setParzialeOk] = useState({}); // ordine -> spuntato «il resto resta da evadere»
  const [tablet, setTablet] = useState(false);
  const [storico, setStorico] = useState(null);
  const [soloStampa, setSoloStampa] = useState(null); // cliente di cui si stampa solo il foglio
  const [ddtFatti, setDdtFatti] = useState({}); // ordine -> esito dell'emissione { ok, testo }
  const [testoProva, setTestoProva] = useState(() => JSON.stringify(ESEMPIO, null, 2));

  async function carica() {
    setErr(''); setCaricamento(true); setEsito(null);
    try {
      const [o, g] = await Promise.all([api.pickingOrdini(), api.pickingGiacenze()]);
      setDati({ ordini: o.ordini, giacenze: g.giacenze });
      setFonte(o.fonte === 'giobby' && g.fonte === 'giobby' ? 'giobby' : 'prova');
      setTestoProva(JSON.stringify({ ordini: o.ordini, giacenze: g.giacenze }, null, 2));
    } catch (e) {
      setErr(e.message);
    } finally { setCaricamento(false); }
  }
  useEffect(() => { carica(); }, []);

  function applicaProva() {
    try {
      const d = JSON.parse(testoProva);
      if (!Array.isArray(d.ordini) || !Array.isArray(d.giacenze)) throw new Error('Servono "ordini" e "giacenze"');
      setDati(d); setFonte('prova'); setEsito(null); setErr('');
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'Il testo non è un JSON valido' : e.message);
    }
  }

  const ordini = dati?.ordini ?? [];
  const clienti = useMemo(() => unici(ordini.map((o) => o.cliente)), [ordini]);
  const stati = useMemo(() => unici(ordini.map((o) => o.stato)), [ordini]);
  const filtrati = useMemo(() => ordini.filter((o) =>
    (!cliente || o.cliente === cliente)
    && (!stato || o.stato === stato)
    && (!da || (o.consegna && o.consegna >= da))
    && (!a || (o.consegna && o.consegna <= a))), [ordini, cliente, stato, da, a]);

  async function creaStampa() {
    setErr(''); setBusy(true);
    try {
      // Si calcola su TUTTI gli ordini da evadere (chi consegna prima si prende i lotti che scadono prima),
      // poi si stampano solo quelli scelti coi filtri: così due stampe diverse non promettono lo stesso lotto.
      const piano = await api.pickingSimula({ ordini: ordini.map((o) => ({ id: o.id, consegna: o.consegna, righe: o.righe.map((r) => ({ articolo: r.articolo, quantita: r.quantita })) })), giacenze: dati.giacenze });
      setEsito({ piano, scelti: new Set(filtrati.map((o) => o.id)), generata: new Date() });
      setRigheOrd(Object.fromEntries(piano.ordini.map((o) => [o.id, o.prelievi.map((p) => ({ articolo: p.articolo, lotto: p.lotto || null, scadenza: p.scadenza || null, ubicazione: p.ubicazione || null, quantita: p.quantita }))])));
      setInModifica(new Set()); setAvvisi({});
    } catch (e) {
      setEsito(null); setErr(e.message);
    } finally { setBusy(false); }
  }

  function stampaFoglio(cliente) {
    setStampati((x) => new Set(x).add(cliente));
    setSoloStampa(cliente);
    setTimeout(() => { window.print(); setSoloStampa(null); }, 80);
  }

  const oggi = new Date().toISOString().slice(0, 10);
  const valide = (g) => !g.scadenza || g.scadenza >= oggi; // lotti non scaduti
  const perScadenza = (x, y) => String(x.scadenza || '9999').localeCompare(String(y.scadenza || '9999'));
  const lottiDi = (art) => (dati?.giacenze ?? []).filter((g) => g.articolo === art && g.lotto && valide(g)).sort(perScadenza);
  const giacenzaLotto = (art, lotto) => (dati?.giacenze ?? []).find((g) => g.articolo === art && (g.lotto || null) === (lotto || null))?.disponibile ?? 0;
  const giacenzaTotale = (art) => (dati?.giacenze ?? []).filter((g) => g.articolo === art && valide(g)).reduce((t, g) => t + g.disponibile, 0);
  const righeDi = (o) => righeOrd[o.id] ?? o.prelievi;
  const nota = (id, testo) => setAvvisi((x) => ({ ...x, [id]: testo }));
  const cambia = (o, f) => setRigheOrd((x) => ({ ...x, [o.id]: f(righeDi(o).map((r) => ({ ...r }))) }));

  function scegliLotto(o, i, lotto) {
    const g = (dati?.giacenze ?? []).find((x) => x.articolo === righeDi(o)[i].articolo && x.lotto === lotto);
    cambia(o, (r) => { r[i] = { ...r[i], lotto, scadenza: g?.scadenza || null, ubicazione: g?.ubicazione || null, quantita: Math.min(Number(r[i].quantita) || 0, g?.disponibile ?? Infinity) }; return r; });
  }
  function aggiungiLotto(o, articolo, ordinato) {
    const r = righeDi(o);
    const usati = new Set(r.filter((x) => x.articolo === articolo).map((x) => x.lotto));
    const somma = r.filter((x) => x.articolo === articolo).reduce((t, x) => t + Number(x.quantita || 0), 0);
    const g = lottiDi(articolo).find((x) => !usati.has(x.lotto) && x.disponibile > 0);
    if (!g) { nota(o.id, `${articolo}: non ci sono altri lotti disponibili in magazzino.`); return; }
    const manca = Math.max(0, Math.round((ordinato - somma) * 1000) / 1000);
    nota(o.id, `Aggiunto il lotto ${g.lotto} (scade il ${fmtData(g.scadenza)}): è quello con la scadenza più vicina tra i lotti non ancora usati. Puoi cambiarlo.`);
    cambia(o, (rr) => {
      const ultimo = rr.map((x) => x.articolo).lastIndexOf(articolo);
      rr.splice(ultimo + 1, 0, { articolo, lotto: g.lotto, scadenza: g.scadenza || null, ubicazione: g.ubicazione || null, quantita: Math.min(manca, g.disponibile) });
      return rr;
    });
  }
  const togliLotto = (o, i) => cambia(o, (r) => { r.splice(i, 1); return r; });
  const tondo = (n) => Math.round(n * 1000) / 1000;
  const sommaArt = (righe, art) => tondo(righe.filter((x) => x.articolo === art).reduce((t, x) => t + (Number(x.quantita) || 0), 0));
  const decOk = (um) => !um || UM_DEC.test(um);
  // Quanto resta di un lotto togliendo quello che gli ALTRI ordini del foglio stanno già usando.
  const libera = (o, art, lotto) => {
    const altri = Object.entries(righeOrd).filter(([id]) => id !== String(o.id)).flatMap(([, rr]) => rr)
      .filter((x) => x.articolo === art && (x.lotto || null) === (lotto || null)).reduce((t, x) => t + (Number(x.quantita) || 0), 0);
    return Math.max(0, tondo(giacenzaLotto(art, lotto) - altri));
  };
  const giorniA = (iso) => (iso ? Math.round((new Date(`${iso}T12:00:00`) - new Date(`${oggi}T12:00:00`)) / 86400000) : null);

  function cambiaQuantita(o, i, v) {
    const r = righeDi(o)[i];
    let q = v === '' ? '' : Number(v);
    if (q !== '') {
      if (!Number.isFinite(q) || q < 0) q = 0;
      if (!decOk(o.ums.get(r.articolo))) q = Math.round(q);
      const altri = sommaArt(righeDi(o), r.articolo) - (Number(r.quantita) || 0);
      const maxLotto = r.lotto ? giacenzaLotto(r.articolo, r.lotto) : Infinity;
      const maxOrdine = (o.ordinati.get(r.articolo) ?? Infinity) - altri;
      if (q > Math.min(maxLotto, maxOrdine)) {
        const max = Math.max(0, tondo(Math.min(maxLotto, maxOrdine)));
        nota(o.id, maxLotto <= maxOrdine ? `${r.articolo} lotto ${r.lotto}: in magazzino ce ne sono solo ${max}.` : `${r.articolo}: l'ordine ne chiede ${o.ordinati.get(r.articolo)} in tutto, quindi qui al massimo ${max}.`);
        q = max;
      }
    }
    cambia(o, (rr) => { rr[i] = { ...rr[i], quantita: q }; return rr; });
  }
  function annullaModifiche(o) {
    setInModifica((x) => { const n = new Set(x); n.delete(o.id); return n; });
    setRigheOrd((x) => { const n = { ...x }; delete n[o.id]; return n; });
    setRiepilogo(null); setParzialeOk((x) => ({ ...x, [o.id]: false }));
    nota(o.id, '');
  }
  const modificato = (o) => JSON.stringify(righeDi(o).map((r) => [r.articolo, r.lotto, Number(r.quantita)])) !== JSON.stringify(o.prelievi.map((r) => [r.articolo, r.lotto || null, Number(r.quantita)]));

  // Paletti: finché ci sono problemi il DDT non si può creare.
  const problemi = (o) => {
    const righe = righeDi(o);
    const out = [];
    righe.forEach((r) => {
      const q = Number(r.quantita);
      if (!Number.isFinite(q) || q < 0) out.push(`${r.articolo}: quantità non valida`);
      else if (r.lotto && q > giacenzaLotto(r.articolo, r.lotto) + 1e-9) out.push(`${r.articolo} lotto ${r.lotto}: ne indichi ${q} ma in magazzino ce ne sono ${giacenzaLotto(r.articolo, r.lotto)}`);
      else if (!decOk(o.ums.get(r.articolo)) && !Number.isInteger(q)) out.push(`${r.articolo}: la quantità deve essere intera (${o.ums.get(r.articolo)})`);
    });
    for (const art of new Set(righe.map((r) => r.articolo))) {
      const tot = sommaArt(righe, art);
      if (o.ordinati.get(art) != null && tot > o.ordinati.get(art) + 1e-9) out.push(`${art}: ${tot} sono più di quelli ordinati (${o.ordinati.get(art)})`);
    }
    const visti = new Set();
    for (const r of righe) { const k = `${r.articolo}|${r.lotto}`; if (visti.has(k)) out.push(`${r.articolo}: il lotto ${r.lotto || '(senza lotto)'} compare due volte`); visti.add(k); }
    if (righe.every((r) => !(Number(r.quantita) > 0))) out.push('Nessuna quantità da consegnare');
    return out;
  };

  async function emettiDdt(o) {
    const prelievi = righeDi(o).map((p) => ({ articolo: p.articolo, lotto: p.lotto || null, scadenza: p.scadenza || null, quantita: Number(p.quantita) })).filter((p) => p.quantita > 0);
    const previsto = o.prelievi.map((p) => ({ articolo: p.articolo, lotto: p.lotto || null, quantita: p.quantita }));
    setBusy(true);
    try {
      const r = await api.pickingDdt(o.idGiobby, prelievi, { parziale: !!parzialeOk[o.id], previsto });
      setDdtFatti((x) => ({ ...x, [o.id]: r.ok ? { ok: true, idDdt: r.idDdt, testo: `${r.riferimento} emesso · ordine ${r.statoOrdine || ''}${r.avvisi?.length ? ` · ${r.avvisi.join('; ')}` : ''}` } : { ok: false, testo: r.error } }));
      if (r.ok) { setRiepilogo(null); setStorico(null); }
    } catch (e) {
      setDdtFatti((x) => ({ ...x, [o.id]: { ok: false, testo: e.message } }));
      setRiepilogo(null);
    } finally { setBusy(false); }
  }

  function pannelloRiepilogo(o) {
    const righe = righeDi(o);
    const ass = [...o.ordinati.entries()].map(([art, ord]) => ({ art, ord, preso: sommaArt(righe, art), lotti: righe.filter((x) => x.articolo === art && Number(x.quantita) > 0) }));
    const parz = ass.filter((x) => x.preso < x.ord - 1e-9);
    return (
      <div className="riepilogo">
        <h4>Riepilogo prima di creare il DDT · {o.id}</h4>
        <table className="riep">
          <thead><tr><th>Articolo</th><th>Richiesto</th><th>Preparato</th><th>Differenza</th><th>Lotti</th></tr></thead>
          <tbody>
            {ass.map((x) => (
              <tr key={x.art} className={x.preso < x.ord - 1e-9 ? 'manca-r' : ''}>
                <td><b>{x.art}</b></td><td>{x.ord}</td><td><b>{x.preso}</b></td>
                <td>{x.preso < x.ord - 1e-9 ? `mancano ${tondo(x.ord - x.preso)}` : '—'}</td>
                <td>{x.lotti.map((l) => `${l.lotto || '(senza lotto)'} × ${l.quantita}`).join('  ·  ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {parz.length > 0 && (
          <label className="parz"><input type="checkbox" checked={!!parzialeOk[o.id]} onChange={(e) => setParzialeOk((x) => ({ ...x, [o.id]: e.target.checked }))} />
            {' '}Consegna parziale: il resto ({parz.map((x) => `${x.art} ${tondo(x.ord - x.preso)}`).join(', ')}) resta da evadere in Giobby
          </label>
        )}
        <p className="muted small">Giobby crea il DDT collegato all'ordine e scarica il magazzino. Da qui non si può annullare.</p>
        <div className="actions">
          <button disabled={busy || (parz.length > 0 && !parzialeOk[o.id])} onClick={() => emettiDdt(o)}>Conferma e crea DDT</button>
          <button className="sec" disabled={busy} onClick={() => setRiepilogo(null)}>Indietro</button>
        </div>
      </div>
    );
  }

  const differenze = (prev, eff) => {
    if (!prev) return '—';
    const m = new Map();
    for (const p of prev) m.set(`${p.articolo}|${p.lotto || ''}`, [Number(p.quantita), 0]);
    for (const e of eff) { const k = `${e.articolo}|${e.lotto || ''}`; m.set(k, [m.get(k)?.[0] ?? 0, Number(e.quantita)]); }
    const d = [...m.entries()].filter(([, [a, b]]) => a !== b).map(([k, [a, b]]) => { const [art, lotto] = k.split('|'); return `${art}${lotto ? ` ${lotto}` : ''}: ${a} → ${b}`; });
    return d.length ? d.join(' · ') : 'come da foglio';
  };

  // Stampa: un foglio per cliente (più ordini dello stesso cliente stanno nello stesso foglio).
  const fogli = useMemo(() => {
    if (!esito) return [];
    const info = new Map(ordini.map((o) => [o.id, o]));
    const perCliente = new Map();
    for (const o of esito.piano.ordini) {
      if (!esito.scelti.has(o.id)) continue;
      const nome = info.get(o.id)?.cliente || 'Cliente non indicato';
      if (!perCliente.has(nome)) perCliente.set(nome, []);
      perCliente.get(nome).push({ ...o, idGiobby: info.get(o.id)?.idGiobby, ordinati: (info.get(o.id)?.righe ?? []).reduce((m, r) => m.set(r.articolo, (m.get(r.articolo) || 0) + Number(r.quantita || 0)), new Map()), descrizioni: new Map((info.get(o.id)?.righe ?? []).map((r) => [r.articolo, r.descrizione])), ums: new Map((info.get(o.id)?.righe ?? []).map((r) => [r.articolo, r.um])) });
    }
    return [...perCliente.entries()].sort((x, y) => x[0].localeCompare(y[0], 'it')).map(([nome, lista]) => ({ cliente: nome, ordini: lista.sort((x, y) => String(x.consegna || '9').localeCompare(String(y.consegna || '9'))) }));
  }, [esito, ordini]);

  const fonteTesto = fonte === 'giobby' ? 'Dati letti da Giobby' : 'Dati di prova (collegamento a Giobby spento o dati scritti a mano)';

  return (
    <div className={tablet ? 'tablet' : ''}>
      <div className="pagetitle noprint">
        <div>
          <h1>Picking <span className="beta">in sviluppo</span></h1>
          <p>Scegli gli ordini da preparare e stampa la lista di prelievo: il programma indica da quale lotto prendere (prima scade, prima esce).</p>
        </div>
      </div>

      <div className="card noprint">
        {caricamento && <p className="muted">Leggo ordini e giacenze da Giobby…</p>}
        {!caricamento && dati && (
          <>
            <div className="filtri-picking">
              <div><label><Etichetta chiave="cliente">Cliente</Etichetta></label>
                <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                  <option value="">Tutti</option>
                  {clienti.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label><Etichetta chiave="stato">Stato ordine</Etichetta></label>
                <select value={stato} onChange={(e) => setStato(e.target.value)}>
                  <option value="">Tutti</option>
                  {stati.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div><label><Etichetta chiave="dal">Consegna dal</Etichetta></label><input type="date" value={da} onChange={(e) => setDa(e.target.value)} /></div>
              <div><label><Etichetta chiave="al">al</Etichetta></label><input type="date" value={a} onChange={(e) => setA(e.target.value)} /></div>
            </div>
            <p className="muted small">{fonteTesto}: {filtrati.length} ordini da evadere con questi filtri (su {ordini.length}), {dati.giacenze.length} lotti in magazzino.</p>
            <div className="actions">
              <Etichetta chiave="crea"><button disabled={busy || !filtrati.length} onClick={creaStampa}>Crea stampa picking</button></Etichetta>
              <Etichetta chiave="rileggi"><button className="sec" disabled={busy || caricamento} onClick={carica}>Rileggi da Giobby</button></Etichetta>
              <Etichetta chiave="tablet"><button className={tablet ? '' : 'sec'} onClick={() => setTablet((t) => !t)}>📱 Modalità tablet {tablet ? 'attiva' : ''}</button></Etichetta>
              {esito && <Etichetta chiave="stampa"><button className="sec" onClick={() => { setStampati(new Set(fogli.map((f) => f.cliente))); window.print(); }}>Stampa</button></Etichetta>}
            </div>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <details className="prova" onToggle={(e) => { if (e.target.open && storico === null) api.pickingStorico().then((r) => setStorico(r.storico)).catch(() => setStorico([])); }}>
          <summary><Etichetta chiave="storico">Storico DDT in uscita</Etichetta></summary>
          {storico === null ? <p className="muted small">Leggo lo storico…</p> : storico.length === 0 ? <p className="muted small">Nessun DDT emesso da questa app.</p> : (
            <table className="riep"><thead><tr><th>Quando</th><th>Ordine</th><th>DDT</th><th>Differenze rispetto al foglio</th></tr></thead>
              <tbody>{storico.map((v, k) => <tr key={k}><td>{new Date(v.quando).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</td><td>{v.ordine}</td><td>{v.ddt}</td><td>{differenze(v.previsto, v.effettivo)}{v.parziale ? ' · parziale' : ''}</td></tr>)}</tbody></table>
          )}
        </details>
        <details className="prova">
          <summary><Etichetta chiave="prova">Modalità prova (dati scritti a mano)</Etichetta></summary>
          <textarea value={testoProva} onChange={(e) => setTestoProva(e.target.value)} rows={12} spellCheck={false} />
          <div className="actions"><button className="sec" onClick={applicaProva}>Usa questi dati</button></div>
        </details>
      </div>

      {fogli.map((f) => (
        <div className={`card foglio${soloStampa && soloStampa !== f.cliente ? ' nonstampare' : ''}`} key={f.cliente}>
          <div className="review-title">
            <h2>Picking · {f.cliente}</h2>
            <span className="muted small">stampato il {esito.generata.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
            <span className="noprint"><Etichetta chiave="stampaFoglio"><button className="sec" onClick={() => stampaFoglio(f.cliente)}>{f.ordini.some((x) => modificato(x)) ? '🖨 Stampa il foglio aggiornato' : '🖨 Stampa questo foglio'}</button></Etichetta></span>
          </div>
          {f.ordini.map((o) => {
            const [classe, etichetta] = STATO[o.stato] || ['', o.stato];
            const lottiPerArticolo = new Map();
            for (const p of o.prelievi) lottiPerArticolo.set(p.articolo, (lottiPerArticolo.get(p.articolo) || 0) + 1);
            return (
              <div className="ordine-picking" key={o.id}>
                <div className="review-title">
                  <h3>Ordine {o.id}{o.consegna ? <span className="muted small"> · consegna {fmtData(o.consegna)}</span> : null}<span className="muted small"> · {new Set(righeDi(o).map((r) => r.articolo)).size} art. · {new Set(righeDi(o).filter((r) => r.lotto && Number(r.quantita) > 0).map((r) => `${r.articolo}|${r.lotto}`)).size} lotti usati</span></h3>
                  <Spiega titolo={etichetta} testo={SPIEGA_STATO[o.stato] || ''}><span className={`chk ${classe}`}>{etichetta}</span></Spiega>
                </div>
                <table className="picking">
                  <thead><tr><Th nome="Articolo" /><Th nome="Lotto" /><Th nome="Scadenza" /><Th nome="Ubicazione" /><Th nome="Giacenza" /><Th nome="Q.tà" /><Th nome="Preparato / differenze" className="diff" /></tr></thead>
                  <tbody>
                    {(() => {
                      const righe = righeDi(o);
                      const articoli = [...new Set(righe.map((r) => r.articolo))];
                      const modifica = inModifica.has(o.id) && !ddtFatti[o.id]?.ok;
                      return articoli.map((art) => {
                        const figli = righe.map((r, i) => ({ r, i })).filter(({ r }) => r.articolo === art);
                        const somma = sommaArt(righe, art);
                        const ordinato = o.ordinati.get(art) ?? somma;
                        const multi = figli.length > 1;
                        const descrizione = o.descrizioni.get(art);
                        const usati = new Set(figli.map(({ r }) => r.lotto));
                        const disponibili = lottiDi(art).filter((g) => g.disponibile > 0);
                        const eccede = somma > ordinato + 1e-9;
                        return (
                          <Fragment key={art}>
                            <tr className={`madre${multi ? ' multi' : ''}${eccede ? ' errore' : ''}`}>
                              <td><div className="art"><Riquadro articolo={art} /><div><b>{art}</b>{descrizione && descrizione !== art ? <div className="muted small">{descrizione}</div> : null}</div></div></td>
                              <td>
                                <Spiega titolo={`Lotti di ${art}`} testo={`In uso in questo ordine: ${figli.map(({ r }) => r.lotto || '(senza lotto)').join(', ')}. Disponibili in magazzino (${disponibili.length}): ${disponibili.map((g) => `${g.lotto} (${g.disponibile}, scade ${fmtData(g.scadenza)})`).join('; ') || 'nessuno'}.`}>
                                  <span className={`chk lotti-tag${multi ? ' warn' : ''}`}>{figli.length} {figli.length === 1 ? 'lotto usato' : 'lotti usati'} su {disponibili.length}</span>
                                </Spiega>
                              </td>
                              <td></td><td></td>
                              <td><span className="small muted">tot. {giacenzaTotale(art)}</span></td>
                              <td><b>{somma}</b>{Math.abs(somma - ordinato) > 1e-9 ? <span className={`small ${somma < ordinato ? 'manca' : 'eccesso'}`}> / {ordinato}</span> : null}</td>
                              <td className="diff"></td>
                            </tr>
                            {figli.map(({ r, i }, k) => {
                              const gl = giacenzaLotto(art, r.lotto);
                              const lib = libera(o, art, r.lotto);
                              const qn = Number(r.quantita);
                              const errore = qn > gl + 1e-9 || !Number.isFinite(qn) || qn < 0;
                              const giorni = giorniA(r.scadenza);
                              const prima = lottiDi(art).filter((g) => g.disponibile > 0 && !usati.has(g.lotto) && r.scadenza && g.scadenza && g.scadenza < r.scadenza)[0];
                              return (
                                <tr key={i} className={`figlia${multi ? ' multi' : ''}${errore ? ' errore' : ''}`}>
                                  <td className="ramo"><span>{k < figli.length - 1 ? '├─' : '└─'}</span></td>
                                  <td>{modifica ? (
                                    <>
                                      <select className="noprint" value={r.lotto || ''} onChange={(e) => scegliLotto(o, i, e.target.value)}>
                                        {!r.lotto && <option value="">(senza lotto)</option>}
                                        {lottiDi(art).filter((g) => g.lotto === r.lotto || !usati.has(g.lotto)).map((g) => <option key={g.lotto} value={g.lotto}>{g.lotto} · scade {fmtData(g.scadenza)} · giac. {g.disponibile}</option>)}
                                      </select>
                                      <span className="solo-stampa">{r.lotto || '—'}</span>
                                    </>
                                  ) : (r.lotto || '—')}
                                  {prima && <div className="fefo noprint">⚠ salti {prima.lotto}, che scade prima ({fmtData(prima.scadenza)})</div>}</td>
                                  <td className={giorni != null && giorni <= 30 ? 'scade' : ''} title={giorni != null && giorni <= 30 ? `Scade tra ${giorni} giorni` : ''}>{r.scadenza ? fmtData(r.scadenza) : '—'}{giorni != null && giorni <= 30 ? <div className="small">tra {giorni} g</div> : null}</td>
                                  <td>{r.ubicazione || '—'}</td>
                                  <td><span className={`small ${errore ? 'eccesso' : 'muted'}`}>{gl}</span>{lib < gl ? <div className="small manca noprint" title="Altri ordini di questo foglio stanno già usando parte di questo lotto">per questo ordine ne restano {lib} (gli altri {tondo(gl - lib)} servono ad altri ordini)</div> : null}</td>
                                  <td>{modifica ? (
                                    <>
                                      <span className="qmod noprint">
                                        <input type="number" min="0" step={decOk(o.ums.get(art)) ? 'any' : 1} value={r.quantita} onChange={(e) => cambiaQuantita(o, i, e.target.value)} />
                                        {figli.length > 1 && <button className="sec x" title="Togli questo lotto" onClick={() => togliLotto(o, i)}>×</button>}
                                      </span>
                                      <b className="solo-stampa">{r.quantita}</b>
                                    </>
                                  ) : <b>{r.quantita}</b>}</td>
                                  <td className="diff"></td>
                                </tr>
                              );
                            })}
                            {modifica && (
                              <tr className="aggiungi noprint">
                                <td colSpan={7}>
                                  <Etichetta chiave="piu"><button className="sec" onClick={() => aggiungiLotto(o, art, ordinato)}>+ aggiungi un altro lotto{somma < ordinato ? ` (mancano ${tondo(ordinato - somma)})` : ''}</button></Etichetta>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                {o.idGiobby && o.prelievi.length > 0 && !ddtFatti[o.id]?.ok && (
                  <div className="passi noprint">
                    {!stampati.has(f.cliente) ? (
                      <p className="muted small"><b>Passo 1.</b> Stampa il foglio (pulsante «Stampa questo foglio» in alto) e daglielo all'operatore. Dopo la preparazione potrai confermare il DDT.</p>
                    ) : riepilogo === o.id ? pannelloRiepilogo(o) : (
                      <>
                        <p className="small"><b>Passo 2.</b> Foglio stampato. L'operatore ha preparato la merce: come è andata?</p>
                        {problemi(o).length > 0 && <div className="err"><b>Non si può creare il DDT:</b><ul>{problemi(o).map((m, k) => <li key={k}>{m}</li>)}</ul></div>}
                        <div className="actions">
                          {!inModifica.has(o.id) ? (
                            <>
                              <Etichetta chiave="conferma"><button disabled={busy || problemi(o).length > 0} onClick={() => setRiepilogo(o.id)}>✔ Tutto come da foglio: controlla e crea DDT</button></Etichetta>
                              <Etichetta chiave="modifica"><button className="sec" disabled={busy} onClick={() => setInModifica((x) => new Set(x).add(o.id))}>✏ Ci sono differenze: modifica le quantità</button></Etichetta>
                            </>
                          ) : (
                            <>
                              <Etichetta chiave="ddt"><button disabled={busy || problemi(o).length > 0} onClick={() => setRiepilogo(o.id)}>Controlla e crea DDT con queste quantità</button></Etichetta>
                              <button className="sec" disabled={busy} onClick={() => annullaModifiche(o)}>Annulla modifiche</button>
                              <span className="muted small">Nella tabella: scegli il lotto, scrivi la quantità preparata davvero, oppure premi «+ aggiungi un altro lotto».</span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {avvisi[o.id] && !ddtFatti[o.id]?.ok && <div className="info noprint">{avvisi[o.id]}</div>}
                {ddtFatti[o.id] && <div className={`noprint ${ddtFatti[o.id].ok ? 'ok' : 'err'}`}>{ddtFatti[o.id].ok ? '✔ ' : ''}{ddtFatti[o.id].testo}{ddtFatti[o.id].idDdt ? <> · <a href={`/api/picking/ddt/${ddtFatti[o.id].idDdt}/pdf`} target="_blank" rel="noreferrer">Apri PDF del DDT</a></> : null}</div>}
                {o.mancanti.map((m, i) => <div className="warn" key={i}>⚠ {m.articolo}: richiesti {m.richiesta}, disponibili {m.prelevata}: mancano {m.mancante}</div>)}
              </div>
            );
          })}
        </div>
      ))}

      {esito && esito.piano.scaduti.length > 0 && (
        <div className="card noprint">
          <div className="warn">⚠ Lotti scaduti, non prelevati: {esito.piano.scaduti.map((s) => `${s.articolo} lotto ${s.lotto} (scaduto il ${fmtData(s.scadenza)}, ${s.quantita})`).join('; ')}</div>
        </div>
      )}
    </div>
  );
}
