import { useEffect, useState } from 'react';
import { api } from './api.js';

const RUOLO_TESTO = { admin: 'Amministratore', ufficio: 'Ufficio', magazzino: 'Magazzino' };
const quando = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' }) : 'mai');

/** Gestione utenti (solo amministratore). */
export function Utenti({ io }) {
  const [dati, setDati] = useState(null);
  const [err, setErr] = useState('');
  const [nuovo, setNuovo] = useState({ username: '', nome: '', ruolo: 'ufficio', password: '' });
  const leggi = () => api.utenti().then(setDati).catch((e) => setErr(e.message));
  useEffect(() => { leggi(); }, []);
  const esegui = async (fn) => { setErr(''); try { await fn(); await leggi(); } catch (e) { setErr(e.message); } };
  return (
    <div>
      <div className="pagetitle"><div><h1>Utenti</h1><p>Chi può entrare nell'app e con quale ruolo. Ufficio: tutto tranne utenti e registro. Magazzino: solo la pagina Magazzino.</p></div></div>
      {err && <div className="err">{err}</div>}
      <div className="card">
        <table className="ordini-elenco">
          <thead><tr><th>Utente</th><th>Nome</th><th>Ruolo</th><th>Ultimo accesso</th><th>Stato</th><th></th></tr></thead>
          <tbody>
            {(dati?.utenti ?? []).map((u) => (
              <tr key={u.id} style={{ cursor: 'default', opacity: u.attivo ? 1 : 0.55 }}>
                <td><b>{u.username}</b></td><td>{u.nome}</td>
                <td><select value={u.ruolo} disabled={u.id === io.id} onChange={(e) => esegui(() => api.ruoloUtente(u.id, e.target.value))}>{dati.ruoli.map((r) => <option key={r} value={r}>{RUOLO_TESTO[r]}</option>)}</select></td>
                <td>{quando(u.ultimo_accesso)}</td>
                <td><span className={`chk ${u.attivo ? 'ok' : ''}`}>{u.attivo ? 'Attivo' : 'Disattivato'}</span></td>
                <td className="azioni-riga">
                  <button className="sec" onClick={() => { const p = window.prompt(`Nuova password per ${u.username} (almeno 8 caratteri):`); if (p) esegui(() => api.resetPassword(u.id, p)); }}>Reimposta password</button>{' '}
                  {u.id !== io.id && <button className="sec" onClick={() => esegui(() => api.attivoUtente(u.id, !u.attivo))}>{u.attivo ? 'Disattiva' : 'Riattiva'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="card form-riga" onSubmit={(e) => { e.preventDefault(); esegui(async () => { await api.creaUtente(nuovo); setNuovo({ username: '', nome: '', ruolo: 'ufficio', password: '' }); }); }}>
        <h3>Nuovo utente</h3>
        <div className="filtri-picking">
          <label>Utente<input value={nuovo.username} onChange={(e) => setNuovo({ ...nuovo, username: e.target.value })} autoComplete="off" /></label>
          <label>Nome e cognome<input value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} autoComplete="off" /></label>
          <label>Ruolo<select value={nuovo.ruolo} onChange={(e) => setNuovo({ ...nuovo, ruolo: e.target.value })}>{(dati?.ruoli ?? ['ufficio']).map((r) => <option key={r} value={r}>{RUOLO_TESTO[r]}</option>)}</select></label>
          <label>Password iniziale<input type="password" value={nuovo.password} onChange={(e) => setNuovo({ ...nuovo, password: e.target.value })} autoComplete="new-password" /></label>
        </div>
        <button disabled={!nuovo.username || nuovo.password.length < 8}>Crea utente</button>
      </form>
    </div>
  );
}

/** Registro delle attività: chi ha fatto cosa e quando. */
export function Registro() {
  const [f, setF] = useState({ utente: '', azione: '', da: '', a: '' });
  const [pag, setPag] = useState(0);
  const [dati, setDati] = useState(null);
  const [utenti, setUtenti] = useState([]);
  const [err, setErr] = useState('');
  const LIM = 50;
  useEffect(() => { api.registroUtenti().then((r) => setUtenti(r.utenti)).catch(() => {}); }, []);
  useEffect(() => { api.registro({ ...f, limit: LIM, offset: pag * LIM }).then(setDati).catch((e) => setErr(e.message)); }, [f, pag]);
  const cambia = (k, v) => { setPag(0); setF((x) => ({ ...x, [k]: v })); };
  return (
    <div>
      <div className="pagetitle"><div><h1>Registro attività</h1><p>Ogni accesso e ogni operazione che modifica qualcosa, con chi l'ha fatta e quando: serve per ritrovare l'origine di un errore.</p></div></div>
      <div className="card">
        <div className="filtri-picking">
          <label>Utente<select value={f.utente} onChange={(e) => cambia('utente', e.target.value)}><option value="">Tutti</option>{utenti.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
          <label>Azione contiene<input value={f.azione} onChange={(e) => cambia('azione', e.target.value)} placeholder="es. DDT in uscita" /></label>
          <label>Dal<input type="date" value={f.da} onChange={(e) => cambia('da', e.target.value)} /></label>
          <label>Al<input type="date" value={f.a} onChange={(e) => cambia('a', e.target.value)} /></label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="tab-scroll">
          <table className="ordini-elenco registro">
            <thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Dettagli</th><th>Esito</th><th>IP</th></tr></thead>
            <tbody>
              {(dati?.righe ?? []).map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td className="nowrap">{quando(r.quando)}</td><td><b>{r.username || '—'}</b></td><td>{r.azione}</td>
                  <td className="small">{r.dettaglio ? Object.entries(r.dettaglio).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') : ''}</td>
                  <td><span className={`chk ${r.esito === 'ok' || !r.esito ? 'ok' : 'err'}`}>{r.esito || 'ok'}</span></td><td className="small muted">{r.ip}</td>
                </tr>
              ))}
              {dati && !dati.righe.length && <tr><td colSpan={6} className="muted">Nessuna attività con questi filtri.</td></tr>}
            </tbody>
          </table>
        </div>
        {dati && (
          <div className="actions" style={{ position: 'static' }}>
            <button className="sec" disabled={pag === 0} onClick={() => setPag(pag - 1)}>← Più recenti</button>
            <span className="muted small">{dati.totale} voci · pagina {pag + 1}</span>
            <button className="sec" disabled={(pag + 1) * LIM >= dati.totale} onClick={() => setPag(pag + 1)}>Più vecchie →</button>
          </div>
        )}
      </div>
    </div>
  );
}
