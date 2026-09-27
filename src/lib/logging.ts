/**
 * Structured Logging with Pino.
 *
 * Provides structured JSON logs with correlation IDs, log levels,
 * and pretty printing for development.
 *
 * Install: npm install pino pino-pretty
 */

import pino from 'pino';

/* ------------------------------------------------------------------ */
/* Logger configuration                                                */
/* ------------------------------------------------------------------ */

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const baseLogger = pino({
  level: logLevel,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'lgu-portal',
    version: process.env.npm_package_version ?? '1.0.0',
    environment: process.env.NODE_ENV ?? 'development',
    hostname: process.env.HOSTNAME ?? 'local',
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-forwarded-for"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.secret',
      '*.token',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
});

/* ------------------------------------------------------------------ */
/* Child logger with context                                           */
/* ------------------------------------------------------------------ */

export function createLogger(context: Record<string, any> = {}) {
  return baseLogger.child(context);
}

/* ------------------------------------------------------------------ */
/* Request logging middleware                                          */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';

export function withLogging(handler: (req: NextRequest, context: { logger: pino.Logger }) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    const traceId = req.headers.get('x-trace-id') ?? crypto.randomUUID();
    const start = Date.now();

    const logger = baseLogger.child({
      traceId,
      method: req.method,
      url: req.url,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      userAgent: req.headers.get('user-agent') ?? 'unknown',
    });

    logger.info({ msg: 'Request started' });

    try {
      const response = await handler(req, { logger });

      const duration = Date.now() - start;
      logger.info({
        msg: 'Request completed',
        status: response.status,
        durationMs: duration,
      });

      response.headers.set('x-trace-id', traceId);
      response.headers.set('x-response-time', `${duration}ms`);

      return response;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error({
        msg: 'Request failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: duration,
      });

      throw error;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Audit logging helper                                                */
/* ------------------------------------------------------------------ */

export function createAuditLogger(traceId: string) {
  return baseLogger.child({
    traceId,
    component: 'audit',
  });
}

/* ------------------------------------------------------------------ */
/* Security event logger                                               */
/* ------------------------------------------------------------------ */

export function createSecurityLogger(traceId: string, event: string) {
  return baseLogger.child({
    traceId,
    component: 'security',
    event,
  });
}

/* ------------------------------------------------------------------ */
/* Default logger export                                               */
/* ------------------------------------------------------------------ */

export const logger = baseLogger;

export default baseLogger;