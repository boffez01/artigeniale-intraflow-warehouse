// Collegamento HTTP a Giobby (login "api-server", come da https://www.giobby.com/apidoc/).
//
// Flusso:
//   1. POST {auth}/realms/api-server/protocol/openid-connect/token  (grant_type=password) -> access_token, refresh_token
//   2. dal JWT si legge idCompany; GET {endpoint}?idCompany=... -> "GiobbyApiURL" (da richiedere ad ogni login)
//   3. ogni chiamata: Authorization: Bearer <token> + X-Giobby-Realm: api-server
//
// Sicurezza: password e token non finiscono MAI nei log né nei messaggi d'errore.
import { config } from './config.js';

const SCADE_PRIMA_MS = 30_000; // rinnova il token 30 s prima della scadenza
const TIMEOUT_MS = 20_000;

/** Errore di Giobby: messaggio leggibile, nessun segreto. */
export class GiobbyError extends Error {
  constructor(message, { status = null, dettaglio = null } = {}) {
    super(message);
    this.name = 'GiobbyError';
    this.status = status;
    this.dettaglio = dettaglio;
  }
}

/** Legge il payload di un JWT (senza verificare la firma: la verifica è di Giobby, a noi serve solo idCompany). */
export function decodificaJwt(token) {
  const parti = String(token || '').split('.');
  if (parti.length < 2) throw new GiobbyError('Token Giobby non valido (non è un JWT)');
  try {
    return JSON.parse(Buffer.from(parti[1], 'base64url').toString('utf8'));
  } catch {
    throw new GiobbyError('Token Giobby non valido (payload illeggibile)');
  }
}

const troncato = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export class GiobbyHttp {
  constructor(cfg = config, fetchImpl = globalThis.fetch) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.sessione = null;   // { accessToken, refreshToken, scadeAlle, idCompany, apiUrl }
    this.loginInCorso = null;
  }

  /** Controlla che le variabili d'ambiente ci siano, prima di fare qualsiasi chiamata. */
  verificaConfigurazione() {
    const mancanti = [
      ['GIOBBY_CLIENT_ID', this.cfg.giobbyClientId],
      ['GIOBBY_USER', this.cfg.giobbyUser],
      ['GIOBBY_CID', this.cfg.giobbyCid],
      ['GIOBBY_PASSWORD', this.cfg.giobbyPassword],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (mancanti.length) throw new GiobbyError(`Configurazione Giobby incompleta: manca ${mancanti.join(', ')} nel file .env`);
  }

  get tokenUrl() {
    return `${this.cfg.giobbyAuthUrl}/realms/${this.cfg.giobbyRealm}/protocol/openid-connect/token`;
  }

  async #chiama(url, init = {}) {
    let res;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const motivo = e?.name === 'TimeoutError' ? 'timeout' : (e?.cause?.code || e?.message || 'errore di rete');
      throw new GiobbyError(`Giobby non raggiungibile (${motivo})`);
    }
    const testo = await res.text();
    let json = null;
    try { json = testo ? JSON.parse(testo) : null; } catch { /* risposta non JSON */ }
    return { res, json, testo };
  }

  async #token(parametri) {
    const { res, json, testo } = await this.#chiama(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(parametri).toString(),
    });
    if (!res.ok || !json?.access_token) {
      const motivo = json?.error_description || json?.error || troncato(testo, 120);
      throw new GiobbyError(`Login Giobby rifiutato (HTTP ${res.status}): ${motivo}`, { status: res.status });
    }
    return json;
  }

  async #leggiEndpoint(accessToken) {
    const claims = decodificaJwt(accessToken);
    const idCompany = claims.idCompany ?? claims.id_company ?? claims.companyId;
    if (idCompany == null) {
      throw new GiobbyError(`Nel token Giobby non trovo idCompany (campi presenti: ${Object.keys(claims).join(', ')})`);
    }
    const url = `${this.cfg.giobbyEndpointUrl}?idCompany=${encodeURIComponent(idCompany)}`;
    const { res, json, testo } = await this.#chiama(url, { headers: { Accept: 'application/json' } });
    if (!res.ok || !json?.GiobbyApiURL) {
      throw new GiobbyError(`Impossibile ottenere l'indirizzo delle API Giobby (HTTP ${res.status}): ${json?.userMessage || json?.developerMessage || troncato(testo, 120)}`, { status: res.status });
    }
    return { idCompany, apiUrl: String(json.GiobbyApiURL).replace(/\/+$/, '') };
  }

  #salva(t, extra = {}) {
    this.sessione = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token || null,
      scadeAlle: Date.now() + Math.max(0, (Number(t.expires_in) || 300) * 1000 - SCADE_PRIMA_MS),
      idCompany: this.sessione?.idCompany ?? null,
      apiUrl: this.sessione?.apiUrl ?? null,
      ...extra,
    };
  }

  /** Login completo: token + indirizzo delle API. Più chiamate contemporanee condividono lo stesso login. */
  async login() {
    this.verificaConfigurazione();
    this.loginInCorso ??= (async () => {
      try {
        const t = await this.#token({
          grant_type: 'password',
          client_id: this.cfg.giobbyClientId,
          username: this.cfg.giobbyUser,
          cid: this.cfg.giobbyCid,
          password: this.cfg.giobbyPassword,
        });
        const { idCompany, apiUrl } = await this.#leggiEndpoint(t.access_token);
        this.sessione = null;
        this.#salva(t, { idCompany, apiUrl: this.cfg.giobbyBaseUrl || apiUrl });
      } finally {
        this.loginInCorso = null;
      }
    })();
    return this.loginInCorso;
  }

  async #rinnova() {
    if (!this.sessione?.refreshToken) return this.login();
    try {
      const t = await this.#token({
        grant_type: 'refresh_token',
        refresh_token: this.sessione.refreshToken,
        client_id: this.cfg.giobbyClientId,
      });
      this.#salva(t);
    } catch {
      this.sessione = null;
      await this.login(); // refresh scaduto: si rifà il login
    }
  }

  async #sessioneValida() {
    if (!this.sessione) await this.login();
    else if (Date.now() >= this.sessione.scadeAlle) await this.#rinnova();
    return this.sessione;
  }

  /**
   * Chiamata alle API Giobby. `percorso` è relativo all'indirizzo delle API (es. "/loggeduser").
   * Ritorna il JSON della risposta. Con un 401 rifà il login una volta sola.
   */
  async richiesta(metodo, percorso, { query, body } = {}, secondaVolta = false) {
    const s = await this.#sessioneValida();
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const url = `${s.apiUrl}${percorso.startsWith('/') ? '' : '/'}${percorso}${qs}`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${s.accessToken}`,
      'X-Giobby-Realm': this.cfg.giobbyRealm,
    };
    const init = { method: metodo, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const { res, json, testo } = await this.#chiama(url, init);
    if (res.status === 401 && !secondaVolta) {
      this.sessione = null;
      return this.richiesta(metodo, percorso, { query, body }, true);
    }
        if (!res.ok) {
      const motivo = json?.userMessage || json?.developerMessage || troncato(testo, 200);
      const allow = res.headers?.get?.('allow'); // sui 405 dice quali metodi accetta quel percorso
      const dettaglio = json ?? (troncato(testo, 500) || (allow ? { allow } : null));
      throw new GiobbyError(`Giobby ${metodo} ${percorso}: HTTP ${res.status}${motivo ? ` - ${motivo}` : ''}${allow ? ` (metodi ammessi: ${allow})` : ''}`, { status: res.status, dettaglio });
    }
    return json;
  }

  get = (percorso, query) => this.richiesta('GET', percorso, { query });
  post = (percorso, body) => this.richiesta('POST', percorso, { body });
}