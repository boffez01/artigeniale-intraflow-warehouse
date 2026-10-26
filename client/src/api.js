// Il backend risponde 422 (validazione) o 502-like con un body JSON che contiene `esito`: non è un errore di rete.
async function call(url, { method = 'GET', body, form } = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await r.json().catch(() => ({}));
  // Sessione scaduta o mai aperta: l'app mostra di nuovo la schermata di accesso (il login stesso risponde 401 per password errata).
  if (r.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('sessione-scaduta'));
  if (!r.ok && !('esito' in data)) throw Object.assign(new Error(data.error || `Errore ${r.status}`), { status: r.status });
  return data;
}

// Query string senza i parametri vuoti
const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
};

export const api = {
  lista: (params) => call(`/api/ddt?${qs(params)}`),
  csvUrl: (params) => `/api/ddt.csv?${qs(params)}`,
  info: () => call('/api/info'),
  me: () => call('/api/auth/me'),
  login: (username, password) => call('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => call('/api/auth/logout', { method: 'POST' }),
  cambiaPassword: (vecchia, nuova) => call('/api/auth/password', { method: 'POST', body: { vecchia, nuova } }),
  utenti: () => call('/api/utenti'),
  creaUtente: (u) => call('/api/utenti', { method: 'POST', body: u }),
  resetPassword: (id, password) => call(`/api/utenti/${id}/password`, { method: 'POST', body: { password } }),
  attivoUtente: (id, attivo) => call(`/api/utenti/${id}/attivo`, { method: 'POST', body: { attivo } }),
  ruoloUtente: (id, ruolo) => call(`/api/utenti/${id}/ruolo`, { method: 'POST', body: { ruolo } }),
  registro: (params) => call(`/api/registro?${qs(params)}`),
  registroUtenti: () => call('/api/registro/utenti'),
  dettaglio: (id) => call(`/api/ddt/${id}`),
  salva: (id, ddt) => call(`/api/ddt/${id}`, { method: 'PUT', body: ddt }),
  invia: (id, ddt) => call(`/api/ddt/${id}/invia`, { method: 'POST', body: ddt }),
  aggiorna: (id, ddt) => call(`/api/ddt/${id}/aggiorna`, { method: 'POST', body: ddt }),
  residuo: (id) => call(`/api/ddt/${id}/residuo`),
  chiudiResiduo: (id, consegna) => call(`/api/ddt/${id}/residuo/chiudi`, { method: 'POST', body: { consegna } }),
  abbinamento: (id, ddt) => call(`/api/ddt/${id}/abbinamento`, { method: 'POST', body: ddt }),
  pickingGiacenze: () => call('/api/picking/giacenze'),
  pickingOrdini: () => call('/api/picking/ordini'),
  pickingEvasi: () => call('/api/picking/ordini-evasi'),
  pickingDdt: (ordine, prelievi, extra = {}) => call('/api/picking/ddt', { method: 'POST', body: { ordine, prelievi, ...extra } }),
  pickingStorico: () => call('/api/picking/storico'),
  pickingRilasci: () => call('/api/picking/rilasci'),
  pickingRilascia: (ordini) => call('/api/picking/rilasci', { method: 'POST', body: { ordini } }),
  pickingRilascioStato: (id, stato, nota, preparate) => call('/api/picking/rilasci/stato', { method: 'POST', body: { id, stato, nota, ...(preparate ? { preparate } : {}) } }),
  pickingPreparate: (id, preparate, nota) => call('/api/picking/rilasci/preparate', { method: 'POST', body: { id, preparate, nota } }),
  pickingVerifica: (id) => call('/api/picking/rilasci/verifica', { method: 'POST', body: { id } }),
  pickingSblocca: (id) => call('/api/picking/rilasci/sblocca', { method: 'POST', body: { id } }),
  pickingRitira: (id) => call('/api/picking/rilasci/ritira', { method: 'POST', body: { id } }),
  pickingSimula: (dati) => call('/api/picking/simula', { method: 'POST', body: dati }),
  scarta: (id) => call(`/api/ddt/${id}/scarta`, { method: 'POST' }),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return call('/api/upload', { method: 'POST', form });
  },
};