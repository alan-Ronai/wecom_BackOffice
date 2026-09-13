import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
const app = await buildApp({ config: { DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', NODE_ENV: 'test' } });
await app.ready();
mkdirSync('../../docs/api', { recursive: true });
writeFileSync('../../docs/api/openapi.json', JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
console.log('wrote docs/api/openapi.json');
