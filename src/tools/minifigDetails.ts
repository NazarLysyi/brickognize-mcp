import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMinifigDetails, getMinifigSets } from "../rebrickable/client.js";
import { TOOL_ANNOTATIONS, toolError, toolSuccess } from "./shared.js";

export function registerMinifigDetailsTool(server: McpServer): void {
  server.registerTool(
    "brickognize_minifig_details",
    {
      title: "LEGO Minifigure Details",
      description:
        "Get detailed information about a LEGO minifigure by its ID: name, parts count, " +
        "and which sets contain this minifigure. " +
        "Use after brickognize_identify_fig to enrich results, or directly with a known minifigure ID.\n\n" +
        'Accepts minifigure IDs like "fig-000001" or set-style IDs.',
      inputSchema: {
        minifigId: z.string().describe('LEGO minifigure ID, e.g. "fig-000001".'),
      },
      annotations: TOOL_ANNOTATIONS,
    },
    async (input) => {
      try {
        const minifig = await getMinifigDetails(input.minifigId);
        const sets = await getMinifigSets(input.minifigId);

        const result = {
          minifig: {
            id: minifig.set_num,
            name: minifig.name,
            numParts: minifig.num_parts,
            imageUrl: minifig.set_img_url,
            url: minifig.set_url,
          },
          appearsInSets: sets.map((s) => ({
            setNum: s.set_num,
            setName: s.name,
            numParts: s.num_parts,
            imageUrl: s.set_img_url,
            setUrl: s.set_url,
          })),
        };

        const summary =
          `Minifigure ${minifig.set_num}: ${minifig.name}. ` +
          `${minifig.num_parts} parts. Appears in ${sets.length} set(s).`;

        return toolSuccess(summary, JSON.stringify(result, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
