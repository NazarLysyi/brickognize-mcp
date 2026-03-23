import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PredictionResult } from "../brickognize/types.js";
import { predict } from "../brickognize/client.js";
import { mapPredictionResult } from "../brickognize/mappers.js";
import { formatToolError } from "../utils/errors.js";
import { PREDICT_ENDPOINTS, resolveImage, TOOL_ANNOTATIONS, toolSuccess } from "./shared.js";

const CONCURRENCY_LIMIT = 5;
const MAX_BATCH_SIZE = 20;

type BatchResultItem =
  | { imagePath: string; status: "success"; result: PredictionResult }
  | { imagePath: string; status: "error"; error: string };

async function processSingleImage(
  imagePath: string,
  endpoint: string,
  includeRaw: boolean,
): Promise<BatchResultItem> {
  try {
    const { blob, filename } = await resolveImage({ imagePath });
    const raw = await predict(endpoint, blob, filename);
    const result = mapPredictionResult(raw, includeRaw);
    return { imagePath, status: "success", result };
  } catch (err) {
    return { imagePath, status: "error", error: formatToolError(err) };
  }
}

/**
 * Runs tasks with a bounded concurrency pool.
 * Preserves result order. Never throws — tasks must handle their own errors.
 */
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function registerBatchIdentifyTool(server: McpServer): void {
  server.registerTool(
    "brickognize_batch_identify",
    {
      title: "Batch Identify LEGO Items",
      description:
        "Identify multiple LEGO items from local image files in a single call. " +
        "Processes all images in parallel and returns an array of results. " +
        "Use this when the user provides a folder of photos or multiple image paths. " +
        "Accepts 1–20 image paths per call.\n\n" +
        "When type='part', color prediction is included automatically in each result's predictedColors field.",
      inputSchema: {
        imagePaths: z
          .array(z.string())
          .min(1)
          .max(MAX_BATCH_SIZE)
          .describe(
            `Array of absolute paths to local image files (JPEG, PNG, or WebP). Max ${MAX_BATCH_SIZE} images per call.`,
          ),
        type: z
          .enum(["general", "part", "set", "fig"])
          .default("part")
          .describe(
            "Type of identification: 'part' for single bricks/elements, 'set' for assembled sets or boxes, 'fig' for minifigures, 'general' when unknown.",
          ),
        includeRaw: z
          .boolean()
          .default(false)
          .describe("When true, includes the raw Brickognize API response in each result."),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ imagePaths, type, includeRaw }) => {
      const endpoint = PREDICT_ENDPOINTS[type];

      const tasks = imagePaths.map(
        (imagePath) => () => processSingleImage(imagePath, endpoint, includeRaw),
      );

      const results = await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT);

      const succeeded = results.filter((r) => r.status === "success").length;
      const failed = results.length - succeeded;

      const summary =
        `Batch complete: ${succeeded}/${results.length} succeeded` +
        (failed > 0 ? `, ${failed} failed.` : ".");

      return toolSuccess(summary, JSON.stringify(results, null, 2));
    },
  );
}
