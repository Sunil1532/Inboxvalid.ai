import { MongoClient } from 'mongodb';
import { config } from './config.js';

class BoundedMap {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }

    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlSec) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      this.map.delete(this.map.keys().next().value); // evict oldest
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  get size() {
    return this.map.size;
  }
}

class MemoryStore {
  constructor(disposableDomains) {
    this.kind = 'memory';
    this.disposable = disposableDomains;
    this.cache = new BoundedMap(config.cache.maxMemoryEntries);
  }

  async isDisposable(domain) {
    return this.disposable.has(domain);
  }

  async getCached(domain) {
    return this.cache.get(domain);
  }

  async setCached(domain, record, ttlSec) {
    this.cache.set(domain, record, ttlSec);
  }

  async stats() {
    return { kind: this.kind, disposable: this.disposable.size, cached: this.cache.size };
  }

  async close() {}
}

class MongoStore {
  constructor(client, disposableDomains) {
    this.kind = 'mongo';
    this.client = client;
    const db = client.db(config.mongoDb);
    this.domains = db.collection('disposable_domains');
    this.cache = db.collection('mx_cache');
    // A small in-process layer in FRONT of Mongo. Even a 1ms round trip is
    // wasteful for a set of domains this hot, and it keeps the p99 flat when
    // Mongo is briefly slow.
    this.hot = new BoundedMap(config.cache.maxMemoryEntries);
    this.seeded = disposableDomains;
  }

  static async connect(disposableDomains) {
    const client = new MongoClient(config.mongoUrl, {
      serverSelectionTimeoutMS: 3000,
      maxPoolSize: 20,
    });
    await client.connect();
    const store = new MongoStore(client, disposableDomains);
    await store.ensureIndexes();
    await store.seed();
    return store;
  }

  async ensureIndexes() {
    await this.domains.createIndex({ domain: 1 }, { unique: true });
  
    await this.cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.cache.createIndex({ domain: 1 }, { unique: true });
  }

  async seed() {
    if ((await this.domains.estimatedDocumentCount()) > 0) return;
    const docs = [...this.seeded].map((domain) => ({ domain, source: 'seed' }));
    if (docs.length) await this.domains.insertMany(docs, { ordered: false });
  }

  async isDisposable(domain) {
    if (this.seeded.has(domain)) return true; // head of the list, no I/O
    const cached = this.hot.get(`d:${domain}`);
    if (cached !== null) return cached;
    const found = await this.domains.findOne({ domain }, { projection: { _id: 1 } });
    const answer = Boolean(found);
    this.hot.set(`d:${domain}`, answer, 3600);
    return answer;
  }

  async getCached(domain) {
    const local = this.hot.get(`c:${domain}`);
    if (local) return local;
    const doc = await this.cache.findOne({ domain });
    if (!doc || doc.expiresAt <= new Date()) return null;
    const record = doc.record;
    this.hot.set(`c:${domain}`, record, 300);
    return record;
  }

  async setCached(domain, record, ttlSec) {
    this.hot.set(`c:${domain}`, record, Math.min(ttlSec, 300));
    await this.cache.updateOne(
      { domain },
      { $set: { domain, record, expiresAt: new Date(Date.now() + ttlSec * 1000) } },
      { upsert: true },
    );
  }

  async stats() {
    return {
      kind: this.kind,
      disposable: await this.domains.estimatedDocumentCount(),
      cached: await this.cache.estimatedDocumentCount(),
    };
  }

  async close() {
    await this.client.close();
  }
}


export async function createStore(disposableDomains) {
  if (!config.mongoUrl) {
    console.log('[store] MONGO_URL not set - using in-memory store');
    return new MemoryStore(disposableDomains);
  }
  try {
    const store = await MongoStore.connect(disposableDomains);
    console.log('[store] connected to MongoDB');
    return store;
  } catch (error) {
    console.warn(`[store] MongoDB unavailable (${error.message}) - falling back to memory`);
    return new MemoryStore(disposableDomains);
  }
}
