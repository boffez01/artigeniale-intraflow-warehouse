// Ricorda l'ultima vista dell'archivio (con filtri e pagina): "← Archivio DDT" da una scheda ci torna esatto.
let ultima = '#/archivio';
export const ricordaLista = (hash) => { ultima = hash; };
export const ultimaLista = () => ultima;