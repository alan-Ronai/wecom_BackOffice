import type { FastifyInstance } from 'fastify';
import users from './users.js';
import roles from './roles.js';
import groupsMap from './groups-map.js';
import groupsSearch from './groups-search.js'; // wave 3: Entra group picker (design 3d)
import sessions from './sessions.js';
import auditR from './audit.js';
import system from './system.js';
import identity from './identity-settings.js'; // stage 5: identity settings
import workflow from './workflow.js'; // wave 5 V3: workflow settings (approver switch, gap thresholds)

export default async function adminRoutes(app: FastifyInstance) {
  await app.register(users);
  await app.register(roles);
  await app.register(groupsMap);
  await app.register(groupsSearch);
  await app.register(sessions);
  await app.register(auditR);
  await app.register(system);
  await app.register(identity);
  await app.register(workflow);
}
