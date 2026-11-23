import { server } from './app.js';
import { config } from './config.js';

server.listen(config.port, () => {
  console.log(`SpilnoDoc запущено: http://localhost:${config.port}`);
});
