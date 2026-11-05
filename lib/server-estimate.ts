import "server-only"
import { estimate, type EstimateRequest } from "@/src/api/handler"
import { join } from "node:path"
import { FileShardLoader } from "@/src/data/file-loader"
import { StaticBenchmarkProvider } from "@/src/data/shard"
import type { BenchmarkProvider } from "@/src/core/benchmark"
import type { EstimateResponse } from "@/lib/estimate"

let cachedProvider: BenchmarkProvider | null = null

export function getProvider(): BenchmarkProvider {
  if (cachedProvider) return cachedProvider
  const loader = new FileShardLoader(join(process.cwd(), "public", "data"))
  cachedProvider = new StaticBenchmarkProvider(loader)
  return cachedProvider
}

/** Run the engine directly on the server. Returns the same JSON the API emits. */
export async function runEstimate(request: EstimateRequest): Promise<EstimateResponse> {
  const response = await estimate(request, getProvider())
  return response as unknown as EstimateResponse
}
