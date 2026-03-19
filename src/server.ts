import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHealthTool } from "./tools/health.js";
import { registerPredictTools } from "./tools/predict.js";
import { registerBatchIdentifyTool } from "./tools/batchPredict.js";

const SERVER_INSTRUCTIONS = `\
You are connected to the Brickognize LEGO recognition server.

Provide imagePath (absolute path to a local image file) to any recognition tool.

WHICH TOOL TO USE:
- Single item, unknown type → brickognize_identify
- Single brick/element → brickognize_identify_part
- Single set box or assembled set → brickognize_identify_set
- Single minifigure → brickognize_identify_fig
- Multiple images at once → brickognize_batch_identify

PREFER brickognize_batch_identify whenever you have 2 or more images — it processes them in parallel and is significantly faster than calling single-image tools sequentially.
`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "brickognize", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerHealthTool(server);
  registerPredictTools(server);
  registerBatchIdentifyTool(server);

  return server;
}
