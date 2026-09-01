#!/usr/bin/env node

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HELP = `Usage:
  node search_videos.mjs --query <text> [options]

Options:
  -q, --query <text>          Required search query.
      --orientation <value>  portrait, landscape, or square (default: portrait).
      --size <value>         small, medium, or large (default: medium).
      --locale <value>       Pexels locale (default: en-US).
      --page <number>        Result page, starting at 1 (default: 1).
      --per-page <number>    Results per page, 1-80 (default: 10).
  -h, --help                  Show this help message.

The PEXELS_API_KEY environment variable is required. The key is never printed.
This command searches metadata only and does not download media.
`;

const ORIENTATIONS = new Set(["portrait", "landscape", "square"]);
const SIZES = new Set(["small", "medium", "large"]);
const GRACEFUL_CLOSE_DELAY_MS = 300;

function parsePositiveInteger(value, optionName, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${optionName} must be an integer between 1 and ${maximum}.`);
  }

  return parsed;
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      query: { type: "string", short: "q" },
      orientation: { type: "string", default: "portrait" },
      size: { type: "string", default: "medium" },
      locale: { type: "string", default: "en-US" },
      page: { type: "string", default: "1" },
      "per-page": { type: "string", default: "10" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return null;
  }

  const query = values.query?.trim();
  const orientation = values.orientation.trim();
  const size = values.size.trim();
  const locale = values.locale.trim();

  if (!query) {
    throw new Error("--query is required and cannot be empty.");
  }

  if (!ORIENTATIONS.has(orientation)) {
    throw new Error("--orientation must be portrait, landscape, or square.");
  }

  if (!SIZES.has(size)) {
    throw new Error("--size must be small, medium, or large.");
  }

  if (!locale) {
    throw new Error("--locale cannot be empty.");
  }

  return {
    query,
    orientation,
    size,
    locale,
    page: parsePositiveInteger(values.page, "--page"),
    perPage: parsePositiveInteger(values["per-page"], "--per-page", 80),
  };
}

function parseToolPayload(result) {
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (result.isError) {
    throw new Error(text || "Pexels MCP search returned an error.");
  }

  if (!text) {
    throw new Error("Pexels MCP search returned no text payload.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Pexels MCP search returned invalid JSON.");
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = readOptions();

  if (options === null) {
    return;
  }

  if (!process.env.PEXELS_API_KEY?.trim()) {
    throw new Error("PEXELS_API_KEY is not set.");
  }

  const serverPath = fileURLToPath(
    new URL(
      "./node_modules/@hanoak/pexels-mcp-server/dist/index.js",
      import.meta.url,
    ),
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      LOG_LEVEL: "error",
    },
  });

  const client = new Client({
    name: "project001-pexels-search-adapter",
    version: "0.1.0",
  });

  let connected = false;

  try {
    await client.connect(transport);
    connected = true;

    const result = await client.callTool({
      name: "pexels_search_videos",
      arguments: {
        query: options.query,
        orientation: options.orientation,
        size: options.size,
        locale: options.locale,
        page: options.page,
        per_page: options.perPage,
      },
    });

    const payload = parseToolPayload(result);
    const manifest = {
      schema_version: 1,
      provider: "pexels",
      retrieved_at: new Date().toISOString(),
      request: {
        query: options.query,
        orientation: options.orientation,
        size: options.size,
        locale: options.locale,
        page: options.page,
        per_page: options.perPage,
      },
      response: payload,
    };

    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    if (connected) {
      await delay(GRACEFUL_CLOSE_DELAY_MS);
      await client.close();
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Pexels metadata search failed: ${message}\n`);
  process.exitCode = 1;
});
