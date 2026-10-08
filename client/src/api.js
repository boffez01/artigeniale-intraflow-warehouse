// Il backend risponde 422 (validazione) o 502-like con un body JSON che contiene `esito`: non è un errore di rete.
async function call(url, { method = 'GET', body, form } = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && !('esito' in data)) throw new Error(data.error || `Errore ${r.status}`);
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
  dettaglio: (id) => call(`/api/ddt/${id}`),
  salva: (id, ddt) => call(`/api/ddt/${id}`, { method: 'PUT', body: ddt }),
  invia: (id, ddt) => call(`/api/ddt/${id}/invia`, { method: 'POST', body: ddt }),
  scarta: (id) => call(`/api/ddt/${id}/scarta`, { method: 'POST' }),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return call('/api/upload', { method: 'POST', form });
  },
};