import { createApp } from './app.js';
import { createStore } from './store.js';
import { config } from './config.js';
import { TOP_DISPOSABLE } from '../../shared/domains.js';
import { DISPOSABLE_TAIL } from './data/disposable-tail.js';

const disposable = new Set([...TOP_DISPOSABLE, ...DISPOSABLE_TAIL]);

const store = await createStore(disposable);
const app = createApp(store);

const server = app.listen(config.port, () => {
  console.log(`[server] InboxValid API on http://localhost:${config.port}`);
  console.log(`[server] ${disposable.size} disposable domains loaded`);
});


for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, draining`);
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
