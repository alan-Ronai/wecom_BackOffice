import type { FastifyServerOptions } from 'fastify';
import type { Config } from '../config.js';

export const REQUEST_ID_HEADER = 'x-request-id';

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  return {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, requestId: req.id, ip: req.ip }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  };
}
