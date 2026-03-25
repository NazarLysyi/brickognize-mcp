import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPartColors, getPartColorSets, getPartDetails } from "../rebrickable/client.js";
import type { RebrickablePartColor } from "../rebrickable/types.js";
import { formatToolError } from "../utils/errors.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

export function normalizeColorName(name: string): string {
  return name.trim().toLowerCase();
}

export function matchColorByName(
  colors: RebrickablePartColor[],
  colorName: string,
): RebrickablePartColor | undefined {
  const normalized = normalizeColorName(colorName);
  return colors.find((c) => normalizeColorName(c.color_name) === normalized);
}

interface PartDetailsResult {
  part: {
    partNum: string;
    name: string;
    imageUrl: string | null;
    url: string;
  };
  totalColors: number;
  totalSetsAppearances: number;
  colorFilter?: string;
  colorMatched?: boolean;
  colorDetails: {
    colorId: number;
    colorName: string;
    numSets: number;
    imageUrl: string | null;
    sets: {
      setNum: string;
      setName: string;
      year: number;
      numParts: number;
      imageUrl: string | null;
      setUrl: string;
    }[];
  }[];
}

async function fetchPartDetails(partId: string, colorName?: string): Promise<PartDetailsResult> {
  const part = await getPartDetails(partId);
  const colors = await getPartColors(partId);

  let targetColors: RebrickablePartColor[];
  let filterMode: "exact" | "top";

  if (colorName) {
    const matched = matchColorByName(colors, colorName);
    if (matched) {
      targetColors = [matched];
      filterMode = "exact";
    } else {
      targetColors = [...colors].sort((a, b) => b.num_sets - a.num_sets).slice(0, 5);
      filterMode = "top";
    }
  } else {
    targetColors = [...colors].sort((a, b) => b.num_sets - a.num_sets).slice(0, 5);
    filterMode = "top";
  }

  // Sequential to respect Rebrickable rate limit (1 req/sec)
  const colorSets = [];
  for (const color of targetColors) {
    const sets = await getPartColorSets(partId, color.color_id);
    colorSets.push({
      colorId: color.color_id,
      colorName: color.color_name,
      numSets: color.num_sets,
      imageUrl: color.part_img_url,
      sets: sets.map((s) => ({
        setNum: s.set_num,
        setName: s.name,
        year: s.year,
        numParts: s.num_parts,
        imageUrl: s.set_img_url,
        setUrl: s.set_url,
      })),
    });
  }

  const totalSets = colors.reduce((sum, c) => sum + c.num_sets, 0);

  return {
    part: {
      partNum: part.part_num,
      name: part.name,
      imageUrl: part.part_img_url,
      url: part.part_url,
    },
    totalColors: colors.length,
    totalSetsAppearances: totalSets,
    ...(colorName ? { colorFilter: colorName, colorMatched: filterMode === "exact" } : {}),
    colorDetails: colorSets,
  };
}

export function registerPartDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_part_details",
    {
      title: "LEGO Part Details",
      description:
        "Get detailed information about a LEGO part by its ID: available colors, " +
        "and which sets contain this part (appears in). " +
        "Use after brickognize_identify_part to enrich results, or directly with a known part number.\n\n" +
        "When colorName is provided (e.g. from predictedColors in identify results), " +
        "returns sets only for that specific color — much faster and more precise.\n" +
        "Without colorName, returns sets for the top 5 most popular colors.\n\n" +
        "For multiple parts at once, use brickognize_batch_part_details instead.",
      inputSchema: {
        partId: z.string().describe('LEGO part number, e.g. "3001" for Brick 2x4.'),
        colorName: z
          .string()
          .describe(
            'Optional color name to filter by (e.g. "Black"). ' +
              "Pass the predicted color name from brickognize_identify_part to get sets for that exact color.",
          )
          .optional(),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const result = await fetchPartDetails(input.partId, input.colorName);
        const summary = buildSingleSummary(result);
        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

type BatchPartEntry = { partId: string; colorName?: string };

type BatchPartResultItem =
  | { partId: string; status: "success"; result: PartDetailsResult }
  | { partId: string; status: "error"; error: string };

export function registerBatchPartDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_batch_part_details",
    {
      title: "Batch LEGO Part Details",
      description:
        "Get details for multiple LEGO parts in a single call: colors, and which sets contain each part.\n\n" +
        "Ideal workflow: call brickognize_batch_identify first, then pass all identified parts " +
        "with their predicted colors to this tool in one call.\n\n" +
        "Each entry needs a partId and optional colorName for targeted color lookup. " +
        "Results are returned in the same order as the input.",
      inputSchema: {
        parts: z
          .array(
            z.object({
              partId: z.string().describe("LEGO part number"),
              colorName: z
                .string()
                .describe('Color name from predictedColors (e.g. "Black")')
                .optional(),
            }),
          )
          .min(1)
          .max(20)
          .describe("Array of parts to look up. Max 20 per call."),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async ({ parts }: { parts: BatchPartEntry[] }) => {
      try {
        const results: BatchPartResultItem[] = [];

        // Process sequentially due to Rebrickable rate limiting (1 req/sec)
        for (const entry of parts) {
          try {
            const result = await fetchPartDetails(entry.partId, entry.colorName);
            results.push({ partId: entry.partId, status: "success", result });
          } catch (err) {
            results.push({ partId: entry.partId, status: "error", error: formatToolError(err) });
          }
        }

        const succeeded = results.filter((r) => r.status === "success").length;
        const failed = results.length - succeeded;

        const summary =
          `Batch part details: ${succeeded}/${results.length} succeeded` +
          (failed > 0 ? `, ${failed} failed.` : ".");

        return toolSuccess(summary, JSON.stringify(results, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

export function buildSingleSummary(result: PartDetailsResult): string {
  let summary = `Part ${result.part.partNum}: ${result.part.name}. `;
  summary += `Available in ${result.totalColors} color(s), appears in ~${result.totalSetsAppearances} set(s).`;

  if (result.colorMatched && result.colorDetails.length === 1) {
    const c = result.colorDetails[0];
    summary += ` Filtered by color "${c.colorName}": ${c.numSets} set(s).`;
  } else if (result.colorFilter && !result.colorMatched) {
    summary += ` Color "${result.colorFilter}" not found in Rebrickable, showing top 5 colors.`;
  } else {
    summary +=
      ` Top colors: ` +
      result.colorDetails.map((c) => `${c.colorName} (${c.numSets} sets)`).join(", ") +
      ".";
  }

  return summary;
}
