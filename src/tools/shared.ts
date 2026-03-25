import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { z } from "zod";
import { formatToolError, imageNotFound, invalidInput } from "../utils/errors.js";

export const PREDICT_ENDPOINTS = {
  general: "/predict/",
  part: "/predict/parts/",
  set: "/predict/sets/",
  fig: "/predict/figs/",
} as const;

type TextContent = { type: "text"; text: string };
export type ToolSuccessResult = { content: TextContent[] };
export type ToolErrorResult = { isError: true; content: TextContent[] };

/** Build a successful tool response with one or more text content blocks. */
export function toolSuccess(...texts: string[]): ToolSuccessResult {
  return { content: texts.map((text) => ({ type: "text", text })) };
}

/** Build an error tool response from a caught exception. */
export function toolError(error: unknown): ToolErrorResult {
  return {
    isError: true,
    content: [{ type: "text", text: formatToolError(error) }],
  };
}

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const imageInputSchema = {
  imagePath: z.string().describe("Absolute path to a local image file (JPEG, PNG, or WebP)."),
  includeRaw: z
    .boolean()
    .describe(
      "When true, includes the raw Brickognize API response alongside formatted results. Useful for debugging.",
    )
    .default(false),
};

export interface ResolvedImage {
  blob: Blob;
  filename: string;
}

export async function resolveImage(input: { imagePath: string }): Promise<ResolvedImage> {
  return resolveFromPath(input.imagePath);
}

/** Strip shell escape characters from drag-and-dropped or terminal-copied paths */
function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\+([ '"()[\]{}])/g, "$1");
}

async function resolveFromPath(imagePath: string): Promise<ResolvedImage> {
  const resolved = resolve(normalizeFilePath(imagePath));

  const ext = extname(resolved).toLowerCase();
  const mime = SUPPORTED_MIME_TYPES[ext];

  if (!mime) {
    throw invalidInput(
      `Unsupported image format "${ext}". Supported: ${Object.keys(SUPPORTED_MIME_TYPES).join(", ")}`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(resolved);
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw imageNotFound(resolved);
    }
    throw err;
  }

  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mime }),
    filename: `image${ext}`,
  };
}
