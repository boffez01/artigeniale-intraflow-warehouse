import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Tag from './Tag.jsx';

export default function Lista() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null); // risultato dell'ultimo upload quando il file contiene più DDT
  const fileRef = useRef(null);

  const carica = useCallback(() => api.lista().then(setRows).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    carica();
    const t = setInterval(carica, 5000); // i DDT acquisiti dal watcher compaiono da soli
    return () => clearInterval(t);
  }, [carica]);

  async function upload(file) {
    if (!file) return;
    setBusy(true); setErr(''); setEsito(null);
    try {
      const r = await api.upload(file);
      if (r.ids.length === 1 && !r.duplicato) window.location.hash = `#/ddt/${r.id}`;
      else { setEsito(r); carica(); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="card">
        <h3>Carica un DDT (PDF / immagine)</h3>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy}
               onChange={(e) => upload(e.target.files[0])} />
        {busy && <p className="info">Lettura con AI in corso… (qualche secondo)</p>}
        {err && <div className="err">{err}</div>}
        {esito && (
          <div className="info">
            {esito.duplicato ? 'File già acquisito: nessuna nuova lettura.' : `Trovati ${esito.ids.length} DDT nel file (uno per scheda).`}{' '}
            Apri: {esito.ids.map((id) => <a key={id} href={`#/ddt/${id}`} style={{ marginRight: 8 }}>#{id}</a>)}
          </div>
        )}
      </div>

      <div className="card">
        <h3>DDT acquisiti</h3>
        <table>
          <thead><tr><th>#</th><th>File</th><th>N° DDT</th><th>Data DDT</th><th>Stato</th><th>Acquisito</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7">Nessun DDT ancora.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{r.filename}</td><td>{r.numero_ddt}</td><td>{r.data_ddt}</td>
                <td><Tag status={r.status} /></td><td>{r.created_at}</td>
                <td><a href={`#/ddt/${r.id}`}>Apri</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}