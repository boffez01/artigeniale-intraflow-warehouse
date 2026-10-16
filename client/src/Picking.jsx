import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';

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
  const [qDdt, setQDdt] = useState({}); // correzioni del back office: `${ordine}|${riga}` -> quantità
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
    } catch (e) {
      setEsito(null); setErr(e.message);
    } finally { setBusy(false); }
  }

  async function emettiDdt(o, idGiobby) {
    const prelievi = o.prelievi.map((p, i) => ({ articolo: p.articolo, lotto: p.lotto || null, scadenza: p.scadenza || null, quantita: Number(qDdt[`${o.id}|${i}`] ?? p.quantita) })).filter((p) => p.quantita > 0);
    const righe = prelievi.map((p) => `${p.articolo} ${p.lotto || '(senza lotto)'}: ${p.quantita}`).join('\n');
    if (!window.confirm(`Emettere il DDT di uscita per ${o.id}?\n\n${righe}\n\nIn Giobby il DDT scarica il magazzino.`)) return;
    setBusy(true);
    try {
      const r = await api.pickingDdt(idGiobby, prelievi);
      setDdtFatti((x) => ({ ...x, [o.id]: r.ok ? { ok: true, testo: `${r.riferimento} emesso · ordine ${r.statoOrdine || ''}${r.avvisi?.length ? ` · ${r.avvisi.join('; ')}` : ''}` } : { ok: false, testo: r.error } }));
    } catch (e) {
      setDdtFatti((x) => ({ ...x, [o.id]: { ok: false, testo: e.message } }));
    } finally { setBusy(false); }
  }

  // Stampa: un foglio per cliente (più ordini dello stesso cliente stanno nello stesso foglio).
  const fogli = useMemo(() => {
    if (!esito) return [];
    const info = new Map(ordini.map((o) => [o.id, o]));
    const perCliente = new Map();
    for (const o of esito.piano.ordini) {
      if (!esito.scelti.has(o.id)) continue;
      const nome = info.get(o.id)?.cliente || 'Cliente non indicato';
      if (!perCliente.has(nome)) perCliente.set(nome, []);
      perCliente.get(nome).push({ ...o, idGiobby: info.get(o.id)?.idGiobby, descrizioni: new Map((info.get(o.id)?.righe ?? []).map((r) => [r.articolo, r.descrizione])) });
    }
    return [...perCliente.entries()].sort((x, y) => x[0].localeCompare(y[0], 'it')).map(([nome, lista]) => ({ cliente: nome, ordini: lista.sort((x, y) => String(x.consegna || '9').localeCompare(String(y.consegna || '9'))) }));
  }, [esito, ordini]);

  const fonteTesto = fonte === 'giobby' ? 'Dati letti da Giobby' : 'Dati di prova (collegamento a Giobby spento o dati scritti a mano)';

  return (
    <>
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
              <div><label>Cliente</label>
                <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                  <option value="">Tutti</option>
                  {clienti.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label>Stato ordine</label>
                <select value={stato} onChange={(e) => setStato(e.target.value)}>
                  <option value="">Tutti</option>
                  {stati.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div><label>Consegna dal</label><input type="date" value={da} onChange={(e) => setDa(e.target.value)} /></div>
              <div><label>al</label><input type="date" value={a} onChange={(e) => setA(e.target.value)} /></div>
            </div>
            <p className="muted small">{fonteTesto}: {filtrati.length} ordini da evadere con questi filtri (su {ordini.length}), {dati.giacenze.length} lotti in magazzino.</p>
            <div className="actions">
              <button disabled={busy || !filtrati.length} onClick={creaStampa}>Crea stampa picking</button>
              <button className="sec" disabled={busy || caricamento} onClick={carica}>Rileggi da Giobby</button>
              {esito && <button className="sec" onClick={() => window.print()}>Stampa</button>}
            </div>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <details className="prova">
          <summary>Modalità prova (dati scritti a mano)</summary>
          <textarea value={testoProva} onChange={(e) => setTestoProva(e.target.value)} rows={12} spellCheck={false} />
          <div className="actions"><button className="sec" onClick={applicaProva}>Usa questi dati</button></div>
        </details>
      </div>

      {fogli.map((f) => (
        <div className="card foglio" key={f.cliente}>
          <div className="review-title">
            <h2>Picking · {f.cliente}</h2>
            <span className="muted small">stampato il {esito.generata.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
          {f.ordini.map((o) => {
            const [classe, etichetta] = STATO[o.stato] || ['', o.stato];
            const lottiPerArticolo = new Map();
            for (const p of o.prelievi) lottiPerArticolo.set(p.articolo, (lottiPerArticolo.get(p.articolo) || 0) + 1);
            return (
              <div className="ordine-picking" key={o.id}>
                <div className="review-title">
                  <h3>Ordine {o.id}{o.consegna ? <span className="muted small"> · consegna {fmtData(o.consegna)}</span> : null}</h3>
                  <span className={`chk ${classe}`}>{etichetta}</span>
                </div>
                <table className="picking">
                  <thead><tr><th>Articolo</th><th>Lotto</th><th>Scadenza</th><th>Ubicazione</th><th>Q.tà</th><th className="diff">Preparato / differenze</th><th className="noprint">Q.tà DDT</th></tr></thead>
                  <tbody>
                    {o.prelievi.map((p, i) => {
                      const multi = lottiPerArticolo.get(p.articolo) > 1;
                      const descrizione = o.descrizioni.get(p.articolo);
                      return (
                        <tr key={i} className={multi ? 'multi' : ''}>
                          <td><b>{p.articolo}</b>{descrizione && descrizione !== p.articolo ? <div className="muted small">{descrizione}</div> : null}</td>
                          <td>{p.lotto || '—'}{multi && <span className="chk warn multi-tag">più lotti</span>}</td>
                          <td>{p.scadenza ? fmtData(p.scadenza) : '—'}</td>
                          <td>{p.ubicazione || '—'}</td>
                          <td><b>{p.quantita}</b></td>
                          <td className="diff"></td>
                          <td className="noprint">
                            <input type="number" min="0" step="any" style={{ width: '5.5em' }} value={qDdt[`${o.id}|${i}`] ?? p.quantita} disabled={!!ddtFatti[o.id]?.ok}
                              onChange={(e) => setQDdt((x) => ({ ...x, [`${o.id}|${i}`]: e.target.value }))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {o.idGiobby && o.prelievi.length > 0 && !ddtFatti[o.id]?.ok && (
                  <div className="actions noprint"><button disabled={busy} onClick={() => emettiDdt(o, o.idGiobby)}>Crea DDT in uscita</button>
                    <span className="muted small">Back office: correggi le quantità secondo le note dell'operatore, poi crea il DDT.</span></div>
                )}
                {ddtFatti[o.id] && <div className={`noprint ${ddtFatti[o.id].ok ? 'ok' : 'err'}`}>{ddtFatti[o.id].ok ? '✔ ' : ''}{ddtFatti[o.id].testo}</div>}
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
    </>
  );
}
