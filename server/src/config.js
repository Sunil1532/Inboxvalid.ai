function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  port: int(process.env.PORT, 4000),

  mongoUrl: process.env.MONGO_URL?.trim() || '',
  mongoDb: process.env.MONGO_DB?.trim() || 'inboxvalid',

 
  corsOrigins: process.env.CORS_ORIGINS?.trim() || '*',

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: int(process.env.RATE_LIMIT_MAX, 120),
  },

 
  maxBatchSize: int(process.env.MAX_BATCH_SIZE, 100),

  dns: {

    timeoutMs: int(process.env.DNS_TIMEOUT_MS, 1500),
    
    servers: list(process.env.DNS_SERVERS),
  },

  cache: {
   
    maxMemoryEntries: int(process.env.CACHE_MAX_ENTRIES, 10_000),

    positiveTtlSec: int(process.env.CACHE_POSITIVE_TTL_SEC, 86_400),
    negativeTtlSec: int(process.env.CACHE_NEGATIVE_TTL_SEC, 300),
  },
};
