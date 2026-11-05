/**
 * Shard loaders for the two deployment targets.
 *
 * Cloudflare Pages serves shards as static assets fetched over the local
 * network binding; Node reads them from disk. Both cache parsed shards in
 * memory, and both refuse to serve a shard that fails integrity validation.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UnverifiedDataError } from "../core/plan-years";

import type { PlanYear } from "../core/types";
import { type BenchmarkShard, type ShardIndex, type ShardLoader, validateShard } from "./shard";

function assertValid(shard: BenchmarkShard, key: string): BenchmarkShard {
  if (shard.planYear !== Number(key.split("/")[0]) || !shard.sourceFile || /synthetic/i.test(shard.sourceFile)) {
    throw new UnverifiedDataError(`Dataset ${key} has missing or invalid source provenance.`);
  }
  const problems = validateShard(shard);
  if (problems.length > 0) {
    throw new Error(
      `Shard ${key} failed integrity validation and will not be served:\n  ` +
        problems.slice(0, 5).join("\n  "),
    );
  }
  return shard;
}

async function missingAsset(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.ok && response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
    const html = await response.text();
    // Cloudflare Pages can resolve an absent static path to this site's homepage.
    if (/<title>Subsidy Dropoff/i.test(html) && /<form\b[^>]*\bid=["']f["']/i.test(html)) return true;
    throw new Error("The benchmark asset returned an unexpected HTML page.");
  }
  return false;
}

/** Reads shards from the filesystem. Used by the dev server and by Node hosts. */
export class FileShardLoader implements ShardLoader {
  private readonly cache = new Map<string, BenchmarkShard | null>();

  constructor(private readonly baseDir: string) {}

  async load(planYear: PlanYear, zip3: string): Promise<BenchmarkShard | null> {
    const key = `${planYear}/${zip3}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    try {
      const raw = await readFile(join(this.baseDir, String(planYear), `${zip3}.json`), "utf8");
      const shard = assertValid(JSON.parse(raw) as BenchmarkShard, key);
      this.cache.set(key, shard);
      return shard;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache.set(key, null);
        return null;
      }
      throw error;
    }
  }

  async loadIndex(planYear: PlanYear): Promise<ShardIndex | null> {
    try {
      const raw = await readFile(join(this.baseDir, String(planYear), "index.json"), "utf8");
      return JSON.parse(raw) as ShardIndex;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

/**
 * Reads shards from a Cloudflare Pages static-asset binding.
 *
 * `fetcher` is the `env.ASSETS` binding. Shards are immutable per deployment,
 * so the in-memory cache lives for the isolate's lifetime.
 */
export class AssetShardLoader implements ShardLoader {
  private readonly cache = new Map<string, BenchmarkShard | null>();

  constructor(
    private readonly fetcher: { fetch(request: Request): Promise<Response> },
    private readonly basePath = "/data",
  ) {}

  async load(planYear: PlanYear, zip3: string): Promise<BenchmarkShard | null> {
    const key = `${planYear}/${zip3}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const response = await this.fetcher.fetch(
      new Request(`https://assets.local${this.basePath}/${planYear}/${zip3}.json`),
    );
    if (await missingAsset(response)) {
      this.cache.set(key, null);
      return null;
    }
    if (!response.ok) {
      throw new Error(`Shard ${key} fetch failed: HTTP ${response.status}`);
    }
    const shard = assertValid((await response.json()) as BenchmarkShard, key);
    this.cache.set(key, shard);
    return shard;
  }

  async loadIndex(planYear: PlanYear): Promise<ShardIndex | null> {
    const response = await this.fetcher.fetch(
      new Request(`https://assets.local${this.basePath}/${planYear}/index.json`),
    );
    if (await missingAsset(response)) return null;
    if (!response.ok) {
      throw new Error(`index.json fetch for plan year ${planYear} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as ShardIndex;
  }
}
