import app from './app.js';
import { env } from './config/env.js';

const port = env.PORT || 4000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://localhost:${port} y en la red local (0.0.0.0:${port})`);
});
