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

export const api = {
  lista: () => call('/api/ddt'),
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