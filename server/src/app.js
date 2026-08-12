import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { validateEmail } from './pipeline.js';

function rateLimit({ windowMs, max }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref(); 

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Try again shortly.',
      });
    }
    return next();
  };
}

export function createApp(store) {
  const app = express();

  app.set('trust proxy', 1); 
  app.use(express.json({ limit: '256kb' }));
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(','),
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 86400, 
    }),
  );

  app.get('/health', async (_req, res) => {
    res.json({ ok: true, store: await store.stats() });
  });

  const single = async (req, res) => {
    const email = req.method === 'GET' ? req.query.email : req.body?.email;
    if (typeof email !== 'string' || !email.length) {
      return res.status(400).json({ error: 'missing_email', message: 'Provide an email address.' });
    }
    if (email.length > 320) {
      return res.status(400).json({ error: 'too_long', message: 'Address exceeds the maximum length.' });
    }
    try {
      return res.json(await validateEmail(email, store));
    } catch (error) {
      req.log?.(error);
      console.error('[validate] unhandled', error);
    
      return res.status(500).json({
        error: 'internal_error',
        verdict: 'unknown',
        message: 'Validation is temporarily unavailable.',
      });
    }
  };

  app.get('/v1/validate', rateLimit(config.rateLimit), single);
  app.post('/v1/validate', rateLimit(config.rateLimit), single);


  app.post('/v1/validate/batch', rateLimit(config.rateLimit), async (req, res) => {
    const emails = req.body?.emails;
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: 'missing_emails', message: 'Provide an array of emails.' });
    }
    if (emails.length > config.maxBatchSize) {
      return res.status(413).json({
        error: 'batch_too_large',
        message: `Maximum ${config.maxBatchSize} addresses per request.`,
      });
    }


    const unique = [...new Set(emails.map((e) => String(e ?? '').trim()))];
    const settled = await Promise.allSettled(unique.map((e) => validateEmail(e, store)));

    const byEmail = new Map();
    unique.forEach((email, i) => {
      const outcome = settled[i];
      byEmail.set(
        email,
        outcome.status === 'fulfilled'
          ? outcome.value
          : { email, verdict: 'unknown', code: 'internal_error', reason: null, checks: {} },
      );
    });

    return res.json({
      count: emails.length,
      results: emails.map((e) => byEmail.get(String(e ?? '').trim())),
    });
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  return app;
}
