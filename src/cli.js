#!/usr/bin/env node
/**
 * socialit-mcp: the Socialit MCP server over stdio, for MCP clients that start local servers
 * (Claude Desktop, and others). It connects to the hosted server with your Socialit API key and
 * forwards everything (src/proxy.js).
 *
 *   SOCIALIT_API_KEY=sk_live_... npx -y @socialit/mcp
 *
 * Environment:
 *   SOCIALIT_API_KEY     a workspace API key (Manage → API keys); required
 *   SOCIALIT_TOOLSETS    only these toolsets, comma-separated (posts,media,accounts,...); optional
 *   SOCIALIT_READ_ONLY   true: only tools that change nothing; optional
 *   SOCIALIT_MCP_URL     another server than https://api.socialit.com/mcp; optional
 *
 * Standard output carries the protocol; messages go to standard error.
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectRemote, DEFAULT_URL, isTrue, normalizeKey, normalizeToolsets, proxyServer } from './proxy.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(version);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`socialit-mcp ${version}: the Socialit MCP server over stdio.

Usage (an MCP client starts it):
  SOCIALIT_API_KEY=sk_live_... npx -y @socialit/mcp

Environment:
  SOCIALIT_API_KEY     a workspace API key (Manage → API keys in Socialit); required
  SOCIALIT_TOOLSETS    only these toolsets, comma-separated, e.g. posts,media,accounts,analytics
  SOCIALIT_READ_ONLY   true: only tools that change nothing
  SOCIALIT_MCP_URL     the server, default ${DEFAULT_URL}

Clients that connect to remote servers can use ${DEFAULT_URL} directly and sign in
with OAuth, or send the header Authorization: Bearer sk_live_... . Docs: https://socialit.com/docs/mcp/`);
  process.exit(0);
}

const fail = (message) => {
  console.error(`socialit-mcp: ${message}`);
  process.exit(1);
};

const apiKey = normalizeKey(process.env.SOCIALIT_API_KEY);
if (!apiKey) {
  fail(
    'SOCIALIT_API_KEY is not set. Create an API key in Socialit (Manage → API keys) and pass it in the ' +
      'environment of this server. Docs: https://socialit.com/docs/mcp/',
  );
}
const url = (process.env.SOCIALIT_MCP_URL || DEFAULT_URL).trim();
const toolsets = normalizeToolsets(process.env.SOCIALIT_TOOLSETS);
const readOnly = isTrue(process.env.SOCIALIT_READ_ONLY);

let client;
try {
  client = await connectRemote({ apiKey, url, version, toolsets, readOnly });
} catch (error) {
  fail(error.message);
}
const server = proxyServer(client, { version, url });
const transport = new StdioServerTransport();

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await Promise.allSettled([server.close(), client.close()]);
  process.exit(0);
};
transport.onclose = close;
process.stdin.on('end', close);
process.on('SIGINT', close);
process.on('SIGTERM', close);

await server.connect(transport);
const narrowed = [toolsets && `toolsets ${toolsets}`, readOnly && 'read only'].filter(Boolean).join(', ');
console.error(`socialit-mcp ${version}: connected to ${url}${narrowed ? ` (${narrowed})` : ''}`);
