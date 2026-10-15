import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';

const num = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(n);
const oggi = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-GG, ora locale

/** Consegna parziale: cosa manca all'ordine di un DDT caricato, e cosa fare del resto. */
export default function Residuo({ id }) {
  const [info, setInfo] = useState(null);
  const [errore, setErrore] = useState('');
  const [data, setData] = useState('');
  const [busy, setBusy] = useState(false);
  const [fatto, setFatto] = useState(null);
  const [errAzione, setErrAzione] = useState('');

  const carica = useCallback(() => api.residuo(id).then(setInfo).catch((e) => setErrore(e.message)), [id]);
  useEffect(() => { setInfo(null); setErrore(''); setFatto(null); setErrAzione(''); setData(''); carica(); }, [carica]);

  if (errore) return <p className="muted small">Controllo dell'ordine non riuscito: {errore}</p>;
  if (!info || !info.disponibile) return null;

  if (fatto) {
    return (
      <div className="card">
        <div className="ok"><b>{fatto.chiuso}</b> è stato chiuso. Il resto ({fatto.righe} {fatto.righe === 1 ? 'articolo' : 'articoli'}) è nel nuovo ordine <b>{fatto.nuovo}</b>.</div>
        <p className="muted small">Quando il fornitore consegna il resto, il DDT che cita il vecchio ordine viene agganciato in automatico al nuovo.</p>
      </div>
    );
  }
  if (!info.mancaQualcosa) return <div className="ok">Ordine {info.ordine.descrizione}: merce completa, non manca niente.</div>;
  if (!info.aperto) {
    return (
      <div className="info">
        Ordine {info.ordine.descrizione} chiuso con merce mancante.{info.successore ? ` Il resto è nell'ordine ${info.successore.descrizione}.` : ''}
      </div>
    );
  }

  const mancanti = info.righe.filter((r) => r.residuo > 0);
  const chiudi = async () => {
    if (!window.confirm(`Chiudere ${info.ordine.descrizione} e creare un nuovo ordine per il resto, con consegna prevista il ${fmtData(data)}?`)) return;
    setBusy(true); setErrAzione('');
    try {
      setFatto(await api.chiudiResiduo(id, data));
    } catch (e) {
      setErrAzione(e.message);
      carica();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Consegna parziale · {info.ordine.descrizione}</h2>
      <div className="warn">Il fornitore non ha consegnato tutto: {mancanti.length === 1 ? 'manca 1 articolo' : `mancano ${mancanti.length} articoli`}.</div>
      <table className="list">
        <thead><tr><th>Articolo</th><th className="num">Ordinato</th><th className="num">Ricevuto</th><th className="num">Manca</th></tr></thead>
        <tbody>
          {info.righe.map((r) => (
            <tr key={r.codice}>
              <td>{r.codice} · {r.descrizione}</td>
              <td className="num">{num(r.ordinato)} {r.um}</td>
              <td className="num">{num(r.ricevuto)} {r.um}</td>
              <td className="num">{r.residuo > 0 ? <b>{num(r.residuo)} {r.um}</b> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><b>Se il resto arriva a breve</b>, non fare niente: l'ordine resta aperto e il prossimo DDT si aggancia da solo.</p>
      <p><b>Se non arriva entro il mese</b>, chiudi l'ordine e crea un nuovo ordine solo per quello che manca:</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>Consegna prevista del resto <input type="date" value={data} min={oggi()} onChange={(e) => setData(e.target.value)} /></label>
        <button disabled={busy || !data} onClick={chiudi}>Chiudi l'ordine e crea quello per il resto</button>
      </div>
      {errAzione && <div className="err">{errAzione}</div>}
    </div>
  );
}