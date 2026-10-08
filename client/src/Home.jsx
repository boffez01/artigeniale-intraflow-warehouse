import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Dropzone from './Dropzone.jsx';
import { dataEstesa, fmtData, fmtFa, saluto } from './format.js';
import Icon from './Icons.jsx';
import { Controlli } from './Tag.jsx';

function Kpi({ href, tono, icona, valore, titolo, nota }) {
  return (
    <a className={`kpi ${tono}`} href={href}>
      <span className="kpi-ico"><Icon n={icona} size={22} /></span>
      <span className="kpi-body">
        <span className="kpi-val">{valore ?? '–'}</span>
        <span className="kpi-tit">{titolo}</span>
        {nota && <span className="kpi-nota">{nota}</span>}
      </span>
    </a>
  );
}

export default function Home({ info }) {
  const [coda, setCoda] = useState(null);       // DDT da lavorare (più vecchi per primi)
  const [recenti, setRecenti] = useState(null); // ultimi caricati
  const [err, setErr] = useState('');

  const carica = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api.lista({ stato: 'da_verificare,errore', sort: 'acquisito', dir: 'asc', limit: 8 }),
        api.lista({ stato: 'caricato', sort: 'acquisito', dir: 'desc', limit: 6 }),
      ]);
      setCoda(a); setRecenti(b); setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    carica();
    const t = setInterval(carica, 5000); // i DDT acquisiti dal watcher compaiono da soli
    return () => clearInterval(t);
  }, [carica]);

  const c = coda?.counts;
  const per = c?.per_stato || {};
  const simulazione = info && info.giobby_mode !== 'api';

  return (
    <>
      <section className="hero">
        <div>
          <h1>{saluto()}</h1>
          <p>{dataEstesa()} · Carico acquisti da DDT</p>
        </div>
        <a className="btn ghost-light" href="#/archivio"><Icon n="list" size={16} />Apri l&apos;archivio</a>
      </section>

      {err && <div className="err">Impossibile leggere i dati: {err}. Controlla che il backend sia acceso (<code>npm start</code>).</div>}

      <section className="kpis">
        <Kpi href="#/archivio?stato=da_verificare" tono="warn" icona="clock" valore={c && (per.da_verificare || 0)} titolo="Da verificare" nota="in attesa di conferma" />
        <Kpi href="#/archivio?stato=errore" tono="err" icona="alert" valore={c && (per.errore || 0)} titolo="In errore" nota="lettura o invio non riusciti" />
        <Kpi href="#/archivio?stato=caricato" tono="ok" icona="check" valore={c && (per.caricato || 0)} titolo="Caricati" nota={simulazione ? 'simulazione: nessun invio reale' : 'registrati su Giobby'} />
        <Kpi href="#/archivio?sort=acquisito" tono="info" icona="inbox" valore={c?.oggi} titolo="Acquisiti oggi" nota={c ? `${c.totale} in archivio` : ''} />
      </section>

      <div className="home-grid">
        <section className="card">
          <div className="card-h">
            <h2>Da lavorare <span className="count">{coda ? coda.total : '…'}</span></h2>
            <a href="#/archivio?stato=da_verificare,errore">Vedi tutti →</a>
          </div>
          {!coda ? <div className="sk-block" /> : coda.items.length === 0 ? (
            <div className="empty small">
              <Icon n="check" size={28} />
              <strong>Tutto in ordine</strong>
              <span>Nessun DDT in attesa di verifica.</span>
            </div>
          ) : (
            <div className="scroll">
              <table className="list">
                <thead><tr><th>Fornitore</th><th>N° DDT</th><th>Data</th><th>Controlli</th><th>Acquisito</th><th /></tr></thead>
                <tbody>
                  {coda.items.map((r) => (
                    <tr key={r.id} className="row" onClick={() => { window.location.hash = `#/ddt/${r.id}`; }}>
                      <td><b>{r.fornitore || <span className="muted">Non letto</span>}</b><div className="sub" title={r.filename}>{r.filename}</div></td>
                      <td>{r.numero_ddt || '—'}</td>
                      <td>{fmtData(r.data_ddt)}</td>
                      <td><Controlli r={r} /></td>
                      <td className="muted">{fmtFa(r.created_at)}</td>
                      <td className="act"><a className="btn sm" href={`#/ddt/${r.id}`} onClick={(e) => e.stopPropagation()}>Rivedi</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="side">
          <section className="card">
            <div className="card-h"><h2>Carica DDT</h2></div>
            <Dropzone onDone={carica} />
          </section>

          <section className="card">
            <div className="card-h"><h2>Ultimi caricati</h2><a href="#/archivio?stato=caricato">Tutti →</a></div>
            {!recenti ? <div className="sk-block short" /> : recenti.items.length === 0 ? (
              <p className="muted pad">Ancora nessun DDT caricato.</p>
            ) : (
              <ul className="recent">
                {recenti.items.map((r) => (
                  <li key={r.id}>
                    <a href={`#/ddt/${r.id}`}>
                      <span className="rec-ico"><Icon n="check" size={16} /></span>
                      <span className="rec-main"><b>{r.fornitore || 'Fornitore non letto'}</b><small>n° {r.numero_ddt || '—'} · {r.n_righe} {r.n_righe === 1 ? 'riga' : 'righe'}</small></span>
                      <span className="rec-t">{fmtFa(r.created_at)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}