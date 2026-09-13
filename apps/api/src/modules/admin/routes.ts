import type { FastifyInstance } from 'fastify';
import users from './users.js';
import roles from './roles.js';
import groupsMap from './groups-map.js';
import sessions from './sessions.js';
import auditR from './audit.js';

export default async function adminRoutes(app: FastifyInstance) {
  await app.register(users);
  await app.register(roles);
  await app.register(groupsMap);
  await app.register(sessions);
  await app.register(auditR);
}
