import { useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';

// Dati di prova (gli stessi articoli del sandbox Giobby): ordini di vendita + giacenze per lotto con ubicazione.
// Finché il collegamento a Giobby non è pronto si possono cambiare a mano per vedere come ragiona il picking.
const ESEMPIO = {
  ordini: [
    { id: 'OV-101', consegna: '2026-10-15', righe: [{ articolo: 'FAR-002', quantita: 50 }, { articolo: 'FAR-003', quantita: 10 }] },
    { id: 'OV-102', consegna: '2026-10-14', righe: [{ articolo: 'FAR-002', quantita: 30 }, { articolo: 'FAR-001', quantita: 5 }] },
  ],
  giacenze: [
    { articolo: 'FAR-002', lotto: 'L2612A', scadenza: '2027-12-31', ubicazione: 'A-01-02', disponibile: 40 },
    { articolo: 'FAR-002', lotto: 'L2612C', scadenza: '2027-03-31', ubicazione: 'B-02-01', disponibile: 25 },
    { articolo: 'FAR-002', lotto: 'L2609Z', scadenza: '2026-09-30', ubicazione: 'A-01-01', disponibile: 50 },
    { articolo: 'FAR-003', lotto: 'L2612B', scadenza: '2028-06-30', ubicazione: 'A-01-10', disponibile: 20 },
  ],
};

const STATO = {
  completo: ['ok', 'Completo'],
  parziale: ['warn', 'Parziale'],
  non_evadibile: ['err', 'Non evadibile'],
};

export default function Picking() {
  const [testo, setTesto] = useState(() => JSON.stringify(ESEMPIO, null, 2));
  const [esito, setEsito] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function calcola() {
    setErr(''); setBusy(true);
    try {
      setEsito(await api.pickingSimula(JSON.parse(testo)));
    } catch (e) {
      setEsito(null);
      setErr(e instanceof SyntaxError ? 'Il testo non è un JSON valido' : e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="pagetitle">
        <div>
          <h1>Picking <span className="beta">in sviluppo</span></h1>
          <p>Il programma sceglie da quale lotto prelevare (prima scade, prima esce) e in che ordine girare il magazzino. Per ora lavora su dati di prova; il collegamento a Giobby arriva dopo.</p>
        </div>
      </div>

      <div className="card">
        <label>Ordini di vendita e giacenze per lotto (dati di prova modificabili)</label>
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} rows={14} spellCheck={false} />
        <div className="actions"><button disabled={busy} onClick={calcola}>Calcola il picking</button></div>
        {err && <div className="err">{err}</div>}
      </div>

      {esito && (
        <>
          {esito.ordini.map((o) => {
            const [classe, etichetta] = STATO[o.stato] || ['', o.stato];
            return (
              <div className="card scroll" key={o.id}>
                <div className="review-title">
                  <h2>Ordine {o.id}{o.consegna ? <span className="muted small"> · consegna {fmtData(o.consegna)}</span> : null}</h2>
                  <span className={`chk ${classe}`}>{etichetta}</span>
                </div>
                <table>
                  <thead><tr><th>Articolo</th><th>Lotto</th><th>Scadenza</th><th>Ubicazione</th><th>Q.tà da prelevare</th></tr></thead>
                  <tbody>
                    {o.prelievi.map((p, i) => (
                      <tr key={i}><td>{p.articolo}</td><td>{p.lotto || '—'}</td><td>{p.scadenza ? fmtData(p.scadenza) : '—'}</td><td>{p.ubicazione || '—'}</td><td><b>{p.quantita}</b></td></tr>
                    ))}
                  </tbody>
                </table>
                {o.mancanti.map((m, i) => <div className="warn" key={i}>⚠ {m.articolo}: richiesti {m.richiesta}, disponibili {m.prelevata}: mancano {m.mancante}</div>)}
              </div>
            );
          })}

          <div className="card scroll">
            <h2>Giro del magazzino</h2>
            <p className="muted small">Tutti i prelievi in ordine di ubicazione; lo stesso lotto richiesto da più ordini è un unico prelievo.</p>
            <table>
              <thead><tr><th>Ubicazione</th><th>Articolo</th><th>Lotto</th><th>Q.tà totale</th><th>Per gli ordini</th></tr></thead>
              <tbody>
                {esito.percorso.map((p, i) => (
                  <tr key={i}><td><b>{p.ubicazione || '—'}</b></td><td>{p.articolo}</td><td>{p.lotto || '—'}</td><td>{p.quantita}</td><td>{p.ordini.map((x) => `${x.id} (${x.quantita})`).join(', ')}</td></tr>
                ))}
              </tbody>
            </table>
            {esito.scaduti.length > 0 && (
              <div className="warn">⚠ Lotti scaduti, non prelevati: {esito.scaduti.map((s) => `${s.articolo} lotto ${s.lotto} (scaduto il ${fmtData(s.scadenza)}, ${s.quantita})`).join('; ')}</div>
            )}
          </div>
        </>
      )}
    </>
  );
}