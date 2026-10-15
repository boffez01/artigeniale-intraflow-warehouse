import { config } from './config.js';
import { createApp } from './app.js';
import { aggiornaTutteLeConsegne } from './service.js';

createApp().listen(config.port, () => {
  console.log(`http://localhost:${config.port}`);
  aggiornaTutteLeConsegne().catch(() => {}); // etichette "Consegna parziale" dei DDT già caricati, in secondo piano
});