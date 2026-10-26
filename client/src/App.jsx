import { useEffect, useState } from 'react';
import { api } from './api.js';
import Archivio from './Archivio.jsx';
import Home from './Home.jsx';
import Icon from './Icons.jsx';
import { Login, Account } from './Accesso.jsx';
import { Registro, Utenti } from './Admin.jsx';
import Magazzino from './Magazzino.jsx';
import Controllo from './Controllo.jsx';
import Picking from './Picking.jsx';
import Review from './Review.jsx';

// Router minimale a hash (#/, #/archivio?stato=errore, #/ddt/12): nessuna dipendenza e nessun fallback da configurare sul server.
// Ogni cambio di hash incrementa `n`: cliccare di nuovo "Archivio DDT" riparte da filtri puliti.
function useHash() {
  const [s, setS] = useState({ hash: window.location.hash || '#/', n: 0 });
  useEffect(() => {
    const on = () => setS((o) => ({ hash: window.location.hash || '#/', n: o.n + 1 }));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return s;
}

function route(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const m = /^\/ddt\/(\d+)/.exec(path);
  if (m) return { name: 'ddt', id: Number(m[1]) };
  if (path.startsWith('/archivio')) return { name: 'archivio', query };
  if (path.startsWith('/picking')) return { name: 'picking' };
  if (path.startsWith('/magazzino')) return { name: 'magazzino' };
  if (path.startsWith('/controllo')) return { name: 'controllo' };
  if (path.startsWith('/utenti')) return { name: 'utenti' };
  if (path.startsWith('/registro')) return { name: 'registro' };
  if (path.startsWith('/account')) return { name: 'account' };
  return { name: 'home' };
}

// Stato del sistema in alto a destra: si capisce a colpo d'occhio se i carichi sono simulati o reali.
function Stato({ info }) {
  if (!info) return null;
  const live = info.giobby_mode === 'api';
  return (
    <div className="pills">
      <span className={`pill ${live ? 'ok' : 'warn'}`} title={live ? 'I carichi vanno su Giobby' : 'Modalità dryrun: i carichi vengono salvati in data/outbox, nulla parte verso Giobby'}>
        <i />Giobby · {live ? 'collegato' : 'simulazione'}
      </span>
      <span className={`pill ${info.gemini_pronto ? 'ok' : 'err'}`} title={info.gemini_pronto ? `Modello: ${info.modello}` : 'Chiave GEMINI_API_KEY mancante nel file .env'}>
        <i />AI · {info.gemini_pronto ? 'pronta' : 'chiave mancante'}
      </span>
    </div>
  );
}

export default function App() {
  const { hash, n } = useHash();
  const r = route(hash);
  const [info, setInfo] = useState(null);
  // utente: undefined = sto controllando, null = non ha fatto l'accesso, oggetto = dentro. Con AUTH=off il server non ha il login: tutto aperto.
  const [utente, setUtente] = useState(undefined);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    api.me().then((x) => setUtente(x.utente)).catch((e) => setUtente(e.status === 401 ? null : { nome: 'Accesso libero', username: '', ruolo: 'admin', libero: true }));
    const fuori = () => setUtente((u) => (u?.libero ? u : null));
    window.addEventListener('sessione-scaduta', fuori);
    return () => window.removeEventListener('sessione-scaduta', fuori);
  }, []);
  useEffect(() => { if (utente) api.info().then(setInfo).catch(() => setInfo(null)); }, [utente]);
  // Il magazzino vede solo la sua pagina
  useEffect(() => { if (utente?.ruolo === 'magazzino' && r.name !== 'magazzino') location.hash = '#/magazzino'; }, [utente, r.name]);
  async function esci() { try { await api.logout(); } catch { /* sessione già chiusa */ } location.hash = '#/'; location.reload(); }

  if (utente === undefined) return <p className="muted" style={{ padding: 24 }}>Controllo l'accesso…</p>;
  if (utente === null) return <Login onOk={(u) => { location.hash = u.ruolo === 'magazzino' ? '#/magazzino' : '#/'; setUtente(u); }} />;
  const admin = utente.ruolo === 'admin';
  const magazz = utente.ruolo === 'magazzino';

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#/">
            <img className="logo-img" src="/logo.png" alt="Artigeniale" />
            <span className="brand-t"><small>Gestione magazzino</small></span>
          </a>
          <nav>
            {!magazz && <a className={r.name === 'home' ? 'on' : ''} href="#/"><Icon n="home" size={17} /><span>Home</span></a>}
            {!magazz && (info?.modulo_b
              ? <a className={r.name === 'picking' ? 'on' : ''} href="#/picking"><Icon n="package" size={17} /><span>Picking</span></a>
              : <span className="soon" title="Modulo B: ottimizzazione picking ed emissione DDT in uscita"><Icon n="package" size={17} /><span>Picking</span><em>presto</em></span>)}
            {info?.modulo_b && <a className={r.name === 'magazzino' ? 'on' : ''} href="#/magazzino"><Icon n="home" size={17} /><span>Magazzino</span></a>}
            {!magazz && info?.modulo_b && <a className={r.name === 'controllo' ? 'on' : ''} href="#/controllo"><Icon n="check" size={17} /><span>Controllo picking</span></a>}
            {!magazz && <a className={r.name === 'archivio' || r.name === 'ddt' ? 'on' : ''} href="#/archivio"><Icon n="list" size={17} /><span>Archivio DDT</span></a>}
          </nav>
          {!magazz && <Stato info={info} />}
          {!utente.libero && (
            <div className="utente-box" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false); }}>
              <button className={`sec utente-btn ${['utenti', 'registro', 'account'].includes(r.name) ? 'on' : ''}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
                <b>{utente.nome || utente.username}</b> <small>({utente.ruolo})</small> <span aria-hidden>▾</span>
              </button>
              {menu && (
                <div className="utente-menu" onClick={() => setMenu(false)}>
                  <a href="#/account">Il mio account</a>
                  {admin && <a href="#/utenti">Utenti</a>}
                  {admin && <a href="#/registro">Registro attività</a>}
                  <button onClick={esci}>Esci</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className={r.name === 'ddt' ? 'wide' : ''}>
        {r.name === 'ddt' && <Review key={r.id} id={r.id} />}
        {r.name === 'archivio' && <Archivio key={n} query={r.query} />}
        {r.name === 'picking' && (info?.modulo_b ? <Picking /> : <p className="muted">Modulo non ancora attivo.</p>)}
        {r.name === 'magazzino' && (info?.modulo_b ? <Magazzino /> : <p className="muted">Modulo non ancora attivo.</p>)}
        {r.name === 'controllo' && (info?.modulo_b ? <Controllo /> : <p className="muted">Modulo non ancora attivo.</p>)}
        {r.name === 'home' && <Home info={info} />}
        {r.name === 'utenti' && admin && <Utenti io={utente} />}
        {r.name === 'registro' && admin && <Registro />}
        {r.name === 'account' && !utente.libero && <Account utente={utente} />}
      </main>

      <footer className="foot">Modulo A · Carico acquisti da DDT · Praxis Futura</footer>
    </>
  );
}