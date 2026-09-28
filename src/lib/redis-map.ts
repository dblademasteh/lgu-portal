/**
 * Redis-backed map for OIDC objects.
 *
 * When REDIS_URL is set, maps are stored in Redis with per-key TTL. When Redis
 * is unavailable the map falls back to an in-memory Map so the portal keeps
 * working.
 */

import { createClient, type RedisClientType } from 'redis';

type Json = string | number | boolean | null | JsonObject | Json[];
interface JsonObject {
  [key: string]: Json;
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class RedisMap<K extends string, V> {
  private memory = new Map<K, V>();
  private client: RedisClientType | null = null;
  private prefix: string;
  private defaultTtlMs: number;
  private ready: Promise<void> | null = null;
  public kind: 'memory' | 'redis' = 'memory';

  constructor(prefix: string, defaultTtlMs: number) {
    this.prefix = prefix;
    this.defaultTtlMs = defaultTtlMs;
  }

  private key(k: K): string {
    return `${this.prefix}:${k}`;
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    if (this.kind === 'redis' || this.client) return;

    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn(`[redis-map:${this.prefix}] error:`, err.message);
      });
      await client.connect();
      this.client = client as unknown as RedisClientType;
      this.kind = 'redis';
    } catch (error) {
      console.warn(`[redis-map:${this.prefix}] unavailable, using memory:`, error);
      this.client = null;
    }
  }

  async get(k: K): Promise<V | undefined> {
    await this.ensure();
    if (this.client) {
      try {
        const raw = await this.client.get(this.key(k));
        if (raw !== null) return deserialize<V>(raw);
      } catch {
        // fall through to memory
      }
    }
    return this.memory.get(k);
  }

  async set(k: K, v: V, ttlMs?: number): Promise<void> {
    await this.ensure();
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (this.client) {
      try {
        await this.client.setEx(this.key(k), Math.max(1, Math.ceil(ttl / 1000)), serialize(v));
      } catch {
        // fall through to memory
      }
    }
    this.memory.set(k, v);
  }

  async delete(k: K): Promise<void> {
    await this.ensure();
    if (this.client) {
      try {
        await this.client.del(this.key(k));
      } catch {
        // ignore
      }
    }
    this.memory.delete(k);
  }

  async values(): Promise<V[]> {
    await this.ensure();
    if (this.client) {
      try {
        const results: V[] = [];
        for await (const rawKey of this.client.scanIterator({ MATCH: `${this.prefix}:*`, COUNT: 200 })) {
          const raw = await this.client.get(rawKey);
          if (raw !== null) {
            try {
              results.push(deserialize<V>(raw));
            } catch {
              // skip
            }
          }
        }
        if (results.length > 0) return results;
      } catch {
        // fall through to memory
      }
    }
    return Array.from(this.memory.values());
  }

  async keys(): Promise<K[]> {
    await this.ensure();
    if (this.client) {
      try {
        const keys: K[] = [];
        for await (const rawKey of this.client.scanIterator({ MATCH: `${this.prefix}:*`, COUNT: 200 })) {
          const k = rawKey.slice(this.prefix.length + 1) as K;
          keys.push(k);
        }
        if (keys.length > 0) return keys;
      } catch {
        // fall through
      }
    }
    return Array.from(this.memory.keys());
  }

  async size(): Promise<number> {
    await this.ensure();
    if (this.client) {
      try {
        let count = 0;
        for await (const _key of this.client.scanIterator({ MATCH: `${this.prefix}:*`, COUNT: 200 })) {
          count++;
        }
        if (count > 0) return count;
      } catch {
        // fall through
      }
    }
    return this.memory.size;
  }

  async clear(): Promise<void> {
    await this.ensure();
    if (this.client) {
      try {
        for await (const key of this.client.scanIterator({ MATCH: `${this.prefix}:*`, COUNT: 200 })) {
          await this.client.del(key);
        }
      } catch {
        // ignore
      }
    }
    this.memory.clear();
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore
      }
      this.client = null;
      this.kind = 'memory';
    }
    this.memory.clear();
  }
}
