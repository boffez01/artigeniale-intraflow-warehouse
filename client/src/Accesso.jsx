import { useState } from 'react';
import { api } from './api.js';

/** Schermata di accesso: utente e password. */
export function Login({ onOk }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function invia(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { onOk((await api.login(username.trim(), password)).utente); } catch (x) { setErr(x.message); setPassword(''); } finally { setBusy(false); }
  }
  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={invia}>
        <img src="/logo.png" alt="Artigeniale" className="login-logo" />
        <h1>Accedi alla gestione magazzino</h1>
        <label>Utente<input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button disabled={busy || !username || !password}>Accedi</button>
        <p className="muted small">Hai dimenticato la password? Chiedi all'amministratore di reimpostarla.</p>
      </form>
    </div>
  );
}

/** Cambio della propria password. */
export function Account({ utente }) {
  const [v, setV] = useState({ vecchia: '', nuova: '', ripeti: '' });
  const [msg, setMsg] = useState(null);
  async function invia(e) {
    e.preventDefault(); setMsg(null);
    if (v.nuova !== v.ripeti) return setMsg({ err: 'Le due password nuove non coincidono' });
    try { await api.cambiaPassword(v.vecchia, v.nuova); setV({ vecchia: '', nuova: '', ripeti: '' }); setMsg({ ok: 'Password cambiata.' }); } catch (x) { setMsg({ err: x.message }); }
  }
  const campo = (k, t) => <label>{t}<input type="password" autoComplete={k === 'vecchia' ? 'current-password' : 'new-password'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>;
  return (
    <div>
      <div className="pagetitle"><div><h1>Il mio account</h1><p>{utente.nome} · {utente.username} · ruolo: {utente.ruolo}</p></div></div>
      <form className="card form-stretto" onSubmit={invia}>
        <h3>Cambia password</h3>
        {campo('vecchia', 'Password attuale')}{campo('nuova', 'Nuova password (almeno 8 caratteri)')}{campo('ripeti', 'Ripeti la nuova password')}
        {msg?.err && <div className="err">{msg.err}</div>}{msg?.ok && <div className="ok">{msg.ok}</div>}
        <button disabled={!v.vecchia || !v.nuova}>Cambia password</button>
      </form>
    </div>
  );
}
