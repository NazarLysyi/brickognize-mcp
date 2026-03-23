import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSetDetails, getSetParts } from "../rebrickable/client.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

export function normalizeSetNum(setId: string): string {
  // Rebrickable expects set numbers with a "-1" suffix (e.g. "75192-1")
  if (!/-\d+$/.test(setId)) {
    return `${setId}-1`;
  }
  return setId;
}

export function registerSetDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_set_details",
    {
      title: "LEGO Set Details",
      description:
        "Get detailed information about a LEGO set by its number: year, theme, piece count, " +
        "and full parts inventory. " +
        "Use after brickognize_identify_set to enrich results, or directly with a known set number.\n\n" +
        'The "-1" suffix is added automatically if missing (e.g. "75192" → "75192-1").',
      inputSchema: {
        setId: z
          .string()
          .describe(
            'LEGO set number, e.g. "75192-1" or "75192". The "-1" suffix is added automatically.',
          ),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const setNum = normalizeSetNum(input.setId);
        const set = await getSetDetails(setNum);
        const parts = await getSetParts(setNum);

        const regularParts = parts.filter((p) => !p.is_spare);
        const spareParts = parts.filter((p) => p.is_spare);

        const result = {
          set: {
            setNum: set.set_num,
            name: set.name,
            year: set.year,
            themeId: set.theme_id,
            numParts: set.num_parts,
            imageUrl: set.set_img_url,
            url: set.set_url,
          },
          parts: regularParts.map((p) => ({
            partNum: p.part.part_num,
            name: p.part.name,
            color: p.color.name,
            colorRgb: p.color.rgb,
            quantity: p.quantity,
            numSets: p.num_sets,
            imageUrl: p.part.part_img_url,
            elementId: p.element_id,
          })),
          spareParts: spareParts.map((p) => ({
            partNum: p.part.part_num,
            name: p.part.name,
            color: p.color.name,
            quantity: p.quantity,
          })),
        };

        const summary =
          `Set ${set.set_num}: ${set.name} (${set.year}). ` +
          `${set.num_parts} pieces, ${regularParts.length} unique parts, ${spareParts.length} spare parts.`;

        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
