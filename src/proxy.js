/**
 * The Socialit MCP server over stdio: a bridge to the hosted server (https://api.socialit.com/mcp,
 * Streamable HTTP) for MCP clients that only start local servers. The tools, their descriptions and
 * their answers all come from the hosted server, so this package never falls behind it: it lists what
 * the hosted server lists for your API key and forwards every call with it.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/** The hosted Socialit MCP server. */
export const DEFAULT_URL = 'https://api.socialit.com/mcp';

/** How long one tool call may take: uploads, reports and calls to the networks can take a while. */
export const CALL_TIMEOUT_MS = 120_000;

/**
 * An API key as people paste it: with or without "Bearer ", with spaces around it.
 * @param {string | undefined} value
 */
export function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim();
}

/**
 * Comma-separated toolset names, as in `?toolsets=` of the hosted server: `posts, media` → `posts,media`.
 * @param {string | undefined} value
 */
export function normalizeToolsets(value) {
  return String(value ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
}

/** @param {string | boolean | undefined} value */
export function isTrue(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

/** A clearer message for the errors people meet when they set it up. */
function explain(error, url) {
  const status = error?.code;
  if (status === 401) {
    return new Error(
      'Socialit refused the API key (401). Check SOCIALIT_API_KEY: a workspace API key (sk_live_...) ' +
        'from Manage → API keys in Socialit, not a password. A deleted, expired or regenerated key stops working.',
    );
  }
  if (status === 403) {
    return new Error(`Socialit refused the API key (403): ${error.message}`);
  }
  if (status === 429) {
    return new Error("Socialit's hourly request budget for this workspace is spent (429): wait and try again.");
  }
  if (typeof status === 'number' && status >= 400) {
    return new Error(`Socialit answered ${status} at ${url}: ${error.message}`);
  }
  const cause = error?.cause?.code || error?.code;
  if (cause === 'ENOTFOUND' || cause === 'ECONNREFUSED' || error?.name === 'TypeError') {
    return new Error(`Cannot reach ${url}: ${error?.cause?.message || error?.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Connects to the hosted server with a Socialit API key.
 * @param {{ apiKey: string, url?: string, version?: string, toolsets?: string, readOnly?: boolean, fetch?: typeof fetch }} options
 *   `toolsets` and `readOnly` narrow the tools as `?toolsets=` and `?read_only=true` do on the hosted server.
 * @returns {Promise<Client>}
 */
export async function connectRemote({ apiKey, url = DEFAULT_URL, version = '0.0.0', toolsets, readOnly = false, fetch: fetchImpl } = {}) {
  const key = normalizeKey(apiKey);
  if (!key) throw new Error('No API key: set SOCIALIT_API_KEY to a Socialit API key (sk_live_...).');
  const headers = { authorization: `Bearer ${key}`, 'user-agent': `socialit-mcp/${version}` };
  const sets = normalizeToolsets(toolsets);
  if (sets) headers['x-mcp-toolsets'] = sets;
  if (readOnly) headers['x-mcp-readonly'] = 'true';
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const client = new Client({ name: 'socialit-mcp', version });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw explain(error, url);
  }
  return client;
}

/**
 * A local MCP server that answers with the hosted server's tools (and prompts and resources, if it has
 * any), forwarding every request through `client`.
 * @param {Client} client  connected with connectRemote()
 * @param {{ version?: string, url?: string }} [options]  `url` names the hosted server in error messages
 * @returns {Server}
 */
export function proxyServer(client, { version = '0.0.0', url = DEFAULT_URL } = {}) {
  const remote = client.getServerVersion();
  const capabilities = client.getServerCapabilities() ?? {};
  const server = new Server(
    {
      name: remote?.name ?? 'socialit',
      title: remote?.title ?? 'Socialit',
      version: remote?.version ?? version,
      ...(remote?.websiteUrl ? { websiteUrl: remote.websiteUrl } : {}),
    },
    {
      capabilities: {
        tools: {},
        ...(capabilities.prompts ? { prompts: {} } : {}),
        ...(capabilities.resources ? { resources: {} } : {}),
      },
      instructions: client.getInstructions(),
    },
  );
  const forward = async (call) => {
    try {
      return await call();
    } catch (error) {
      throw explain(error, url);
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, (request) => forward(() => client.listTools(request.params)));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    forward(() => client.callTool(request.params, undefined, { timeout: CALL_TIMEOUT_MS })),
  );
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (request) => forward(() => client.listPrompts(request.params)));
    server.setRequestHandler(GetPromptRequestSchema, (request) => forward(() => client.getPrompt(request.params)));
  }
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (request) => forward(() => client.listResources(request.params)));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
      forward(() => client.listResourceTemplates(request.params)),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (request) => forward(() => client.readResource(request.params)));
  }
  return server;
}
