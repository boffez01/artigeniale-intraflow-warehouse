import test from 'node:test';
import assert from 'node:assert/strict';
import { GiobbyError, GiobbyHttp, decodificaJwt } from '../src/giobbyHttp.js';

const jwt = (claims) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.firma`;

const cfg = {
  giobbyAuthUrl: 'https://auth.example/auth',
  giobbyEndpointUrl: 'https://login.example/v1/endpoint',
  giobbyRealm: 'api-server',
  giobbyClientId: 'CLIENT-1',
  giobbyUser: 'utente-test',
  giobbyCid: 'cid-test',
  giobbyPassword: 'Segreta#123',
  giobbyBaseUrl: '',
};

const risposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
});

/** fetch finto: registra le chiamate e risponde secondo l'URL. */
function finto(gestori) {
  const chiamate = [];
  const fn = async (url, init = {}) => {
    chiamate.push({ url: String(url), init });
    for (const [parte, h] of gestori) if (String(url).includes(parte)) return h(chiamate.filter((c) => c.url.includes(parte)).length, init);
    return risposta(404, 'non trovato');
  };
  return { fn, chiamate };
}

const tokenOk = (scadenza = 300) => risposta(200, { access_token: jwt({ idCompany: 777 }), refresh_token: 'R1', expires_in: scadenza });

test('decodificaJwt legge il payload e rifiuta le stringhe che non sono JWT', () => {
  assert.equal(decodificaJwt(jwt({ idCompany: 5 })).idCompany, 5);
  assert.throws(() => decodificaJwt('abc'), GiobbyError);
  assert.throws(() => decodificaJwt('a.b.c'), GiobbyError);
});

test('login: token con password, poi indirizzo API da idCompany; la chiamata porta gli header richiesti', async () => {
  const { fn, chiamate } = finto([
    ['/realms/api-server/protocol/openid-connect/token', () => tokenOk()],
    ['/v1/endpoint', () => risposta(200, { responseCode: 200, errorCode: 0, GiobbyApiURL: 'https://api.example/v1/' })],
    ['https://api.example/v1/loggeduser', () => risposta(200, { ok: true })],
  ]);
  const g = new GiobbyHttp(cfg, fn);
  assert.deepEqual(await g.get('/loggeduser'), { ok: true });

  const login = chiamate[0];
  const corpo = new URLSearchParams(login.init.body);
  assert.equal(login.init.method, 'POST');
  assert.equal(corpo.get('grant_type'), 'password');
  assert.equal(corpo.get('client_id'), 'CLIENT-1');
  assert.equal(corpo.get('username'), 'utente-test');
  assert.equal(corpo.get('cid'), 'cid-test');
  assert.equal(corpo.get('password'), 'Segreta#123');

  assert.ok(chiamate[1].url.endsWith('/v1/endpoint?idCompany=777'));
  const api = chiamate[2];
  assert.equal(api.url, 'https://api.example/v1/loggeduser', 'niente doppia barra');
  assert.match(api.init.headers.Authorization, /^Bearer ey/);
  assert.equal(api.init.headers['X-Giobby-Realm'], 'api-server');
});

test('il token valido viene riusato; scaduto viene rinnovato con il refresh_token', async () => {
  const { fn, chiamate } = finto([
    ['/protocol/openid-connect/token', (_n, init) => (new URLSearchParams(init.body).get('grant_type') === 'refresh_token'
      ? risposta(200, { access_token: jwt({ idCompany: 777 }), refresh_token: 'R2', expires_in: 300 })
      : tokenOk(1))], // expires_in 1 s: scade subito (margine di 30 s)
    ['/v1/endpoint', () => risposta(200, { GiobbyApiURL: 'https://api.example/v1' })],
    ['https://api.example/v1/x', () => risposta(200, { n: 1 })],
  ]);
  const g = new GiobbyHttp(cfg, fn);
  await g.get('/x');
  await g.get('/x');
  const tokenCalls = chiamate.filter((c) => c.url.includes('/protocol/openid-connect/token'));
  assert.equal(tokenCalls.length, 2, 'un login + un refresh');
  assert.equal(new URLSearchParams(tokenCalls[1].init.body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(tokenCalls[1].init.body).get('refresh_token'), 'R1');
  assert.equal(chiamate.filter((c) => c.url.includes('/v1/endpoint')).length, 1, "l'indirizzo API non si rilegge al refresh");
});

test('con un 401 rifà il login e riprova una volta sola', async () => {
  const { fn, chiamate } = finto([
    ['/protocol/openid-connect/token', () => tokenOk()],
    ['/v1/endpoint', () => risposta(200, { GiobbyApiURL: 'https://api.example/v1' })],
    ['https://api.example/v1/y', (n) => (n === 1 ? risposta(401, 'scaduto') : risposta(200, { riuscito: true }))],
  ]);
  const g = new GiobbyHttp(cfg, fn);
  assert.deepEqual(await g.get('/y'), { riuscito: true });
  assert.equal(chiamate.filter((c) => c.url.includes('/protocol/openid-connect/token')).length, 2);
});

test('errori: credenziali rifiutate, risposta di errore, rete giù. Nessun segreto nei messaggi', async () => {
  let g = new GiobbyHttp(cfg, finto([['/protocol/openid-connect/token', () => risposta(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' })]]).fn);
  await assert.rejects(() => g.login(), (e) => {
    assert.ok(e instanceof GiobbyError);
    assert.match(e.message, /Login Giobby rifiutato \(HTTP 401\): Invalid user credentials/);
    assert.ok(!e.message.includes('Segreta#123'));
    return true;
  });

  g = new GiobbyHttp(cfg, finto([
    ['/protocol/openid-connect/token', () => tokenOk()],
    ['/v1/endpoint', () => risposta(200, { GiobbyApiURL: 'https://api.example/v1' })],
    ['https://api.example/v1/z', () => risposta(400, { userMessage: 'Campo non valido', developerMessage: 'dettaglio' })],
  ]).fn);
  await assert.rejects(() => g.get('/z'), (e) => e.status === 400 && /Campo non valido/.test(e.message) && !e.message.includes('ey'));

  g = new GiobbyHttp(cfg, async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
  await assert.rejects(() => g.login(), /Giobby non raggiungibile \(ENOTFOUND\)/);
});

test('configurazione incompleta: dice quali variabili mancano, senza chiamare la rete', async () => {
  let chiamato = false;
  const g = new GiobbyHttp({ ...cfg, giobbyPassword: '', giobbyCid: '' }, async () => { chiamato = true; });
  await assert.rejects(() => g.login(), /manca GIOBBY_CID, GIOBBY_PASSWORD nel file \.env/);
  assert.equal(chiamato, false);
});

test('token senza idCompany: errore chiaro con i nomi dei campi (non i valori)', async () => {
  const g = new GiobbyHttp(cfg, finto([['/protocol/openid-connect/token', () => risposta(200, { access_token: jwt({ sub: 'segreto-123', altro: 1 }), expires_in: 300 })]]).fn);
  await assert.rejects(() => g.login(), (e) => /idCompany/.test(e.message) && /sub, altro/.test(e.message) && !e.message.includes('segreto-123'));
});

test('GIOBBY_BASE_URL forza l’indirizzo delle API', async () => {
  const { fn, chiamate } = finto([
    ['/protocol/openid-connect/token', () => tokenOk()],
    ['/v1/endpoint', () => risposta(200, { GiobbyApiURL: 'https://api.example/v1' })],
    ['https://forzato.example/api/p', () => risposta(200, {})],
  ]);
  const g = new GiobbyHttp({ ...cfg, giobbyBaseUrl: 'https://forzato.example/api' }, fn);
  await g.get('/p', { a: '1' });
  assert.ok(chiamate.at(-1).url.endsWith('https://forzato.example/api/p?a=1'));
});