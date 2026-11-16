/**
 * The bridge against a stand-in for the hosted server, built as the real one is (apps/api/src/mcp in
 * Socialit): the MCP SDK's Streamable HTTP transport, stateless, JSON responses, 405 on GET and DELETE,
 * an API key in Authorization, `X-MCP-Toolsets` and `X-MCP-Readonly` to narrow the tools.
 */
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { connectRemote, isTrue, normalizeKey, normalizeToolsets, proxyServer } from '../src/proxy.js';

const KEY = 'sk_live_test0123456789';
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const INSTRUCTIONS = 'Socialit is API-first social media management. Call get-current-workspace when unsure which workspace.';

/** The hosted server's stand-in. `read_only` keeps the read tools only, `toolsets` filters by toolset. */
function hosted({ toolsets, readOnly }) {
  const server = new McpServer({ name: 'socialit', title: 'Socialit', version: '9.9.9', websiteUrl: 'https://socialit.com' }, { instructions: INSTRUCTIONS });
  const tools = [
    ['get-current-workspace', 'workspace', true, 'The workspace this connection acts on.', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ workspace: { id: 'ws_1', name: 'Northwind' }, auth: 'api_key' }) }],
    })],
    ['list-posts', 'posts', true, 'List posts.', { status: z.string().optional() }, async ({ status }) => ({
      content: [{ type: 'text', text: `posts with status ${status ?? 'any'}` }],
    })],
    ['create-post', 'posts', false, 'Create a post.', { content: z.string(), draft: z.boolean().optional() }, async ({ content, draft }) => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'pst_1', content, status: draft ? 'draft' : 'scheduled' }) }],
    })],
    ['delete-webhook', 'webhooks', false, 'Delete a webhook.', { id: z.string() }, async () => ({
      isError: true,
      content: [{ type: 'text', text: 'This API key does not allow this action.\nCode: permission_error' }],
    })],
  ];
  for (const [name, toolset, read, description, inputSchema, run] of tools) {
    if (readOnly && !read) continue;
    if (toolsets && toolset !== 'workspace' && !toolsets.includes(toolset)) continue;
    server.registerTool(name, { description, inputSchema }, run);
  }
  return server;
}

let http;
let url;
const requests = [];

before(async () => {
  http = createServer(async (req, res) => {
    requests.push({
      method: req.method,
      authorization: req.headers.authorization,
      userAgent: req.headers['user-agent'],
      toolsets: req.headers['x-mcp-toolsets'],
      readOnly: req.headers['x-mcp-readonly'],
    });
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer resource_metadata="https://api.socialit.com/.well-known/oauth-protected-resource/mcp"',
      });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid API key' }, id: null }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const server = hosted({
      toolsets: req.headers['x-mcp-toolsets']?.split(','),
      readOnly: req.headers['x-mcp-readonly'] === 'true',
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${http.address().port}/mcp`;
});

after(() => new Promise((resolve) => http.close(resolve)));

/** A client of the local bridge, in memory. */
async function bridged(options = {}) {
  const remote = await connectRemote({ apiKey: KEY, url, version: '1.2.3', ...options });
  const server = proxyServer(remote, { version: '1.2.3', url });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await remote.close();
    },
  };
}

describe('options', () => {
  test('takes a key as people paste it', () => {
    assert.equal(normalizeKey('  sk_live_abc  '), 'sk_live_abc');
    assert.equal(normalizeKey('Bearer sk_live_abc'), 'sk_live_abc');
    assert.equal(normalizeKey('bearer   sk_live_abc '), 'sk_live_abc');
    assert.equal(normalizeKey(undefined), '');
  });

  test('takes toolsets and read only as people write them', () => {
    assert.equal(normalizeToolsets(' Posts, media ,, accounts '), 'posts,media,accounts');
    assert.equal(normalizeToolsets(undefined), '');
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', true]) assert.equal(isTrue(value), true);
    for (const value of ['', '0', 'false', 'no', undefined]) assert.equal(isTrue(value), false);
  });
});

describe('the bridge', () => {
  test("lists the hosted server's tools, with its name and instructions", async () => {
    const { client, close } = await bridged();
    try {
      assert.equal(client.getServerVersion().name, 'socialit');
      assert.equal(client.getServerVersion().title, 'Socialit');
      assert.equal(client.getServerVersion().version, '9.9.9');
      assert.equal(client.getInstructions(), INSTRUCTIONS);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['get-current-workspace', 'list-posts', 'create-post', 'delete-webhook']);
      const create = tools.find((t) => t.name === 'create-post');
      assert.equal(create.description, 'Create a post.');
      assert.deepEqual(create.inputSchema.required, ['content']);
    } finally {
      await close();
    }
  });

  test('forwards a call with its arguments and returns the answer', async () => {
    const { client, close } = await bridged();
    try {
      const result = await client.callTool({ name: 'create-post', arguments: { content: 'Hello', draft: true } });
      assert.deepEqual(JSON.parse(result.content[0].text), { id: 'pst_1', content: 'Hello', status: 'draft' });
      assert.notEqual(result.isError, true);
    } finally {
      await close();
    }
  });

  test("passes a tool's error on as it is, for the assistant to read", async () => {
    const { client, close } = await bridged();
    try {
      const result = await client.callTool({ name: 'delete-webhook', arguments: { id: 'wh_1' } });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /permission_error/);
    } finally {
      await close();
    }
  });

  test('narrows the tools with toolsets and read only', async () => {
    const posts = await bridged({ toolsets: 'posts' });
    try {
      const { tools } = await posts.client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['get-current-workspace', 'list-posts', 'create-post']);
    } finally {
      await posts.close();
    }
    const readOnly = await bridged({ readOnly: true });
    try {
      const { tools } = await readOnly.client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['get-current-workspace', 'list-posts']);
    } finally {
      await readOnly.close();
    }
  });

  test('sends the API key, its own user agent and the narrowing headers', async () => {
    requests.length = 0;
    const { client, close } = await bridged({ toolsets: 'posts, media', readOnly: true });
    try {
      await client.listTools();
    } finally {
      await close();
    }
    const posts = requests.filter((r) => r.method === 'POST');
    assert.ok(posts.length >= 2);
    for (const r of posts) {
      assert.equal(r.authorization, `Bearer ${KEY}`);
      assert.equal(r.userAgent, 'socialit-mcp/1.2.3');
      assert.equal(r.toolsets, 'posts,media');
      assert.equal(r.readOnly, 'true');
    }
  });

  test('says when the key is refused', async () => {
    await assert.rejects(connectRemote({ apiKey: 'sk_live_wrong', url }), /refused the API key \(401\)/);
  });

  test('asks for a key when there is none', async () => {
    await assert.rejects(connectRemote({ apiKey: '  ', url }), /SOCIALIT_API_KEY/);
  });

  test('says when the server cannot be reached', async () => {
    await assert.rejects(connectRemote({ apiKey: KEY, url: 'http://127.0.0.1:9/mcp' }), /Cannot reach http:\/\/127\.0\.0\.1:9\/mcp/);
  });
});

describe('socialit-mcp, the command', () => {
  test('serves the tools over stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: { PATH: process.env.PATH, SOCIALIT_API_KEY: ` Bearer ${KEY} `, SOCIALIT_MCP_URL: url },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 4);
      const result = await client.callTool({ name: 'get-current-workspace', arguments: {} });
      assert.match(result.content[0].text, /Northwind/);
    } finally {
      await client.close();
    }
  });

  test('narrows the tools from the environment', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: { PATH: process.env.PATH, SOCIALIT_API_KEY: KEY, SOCIALIT_MCP_URL: url, SOCIALIT_TOOLSETS: 'posts', SOCIALIT_READ_ONLY: 'true' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ['get-current-workspace', 'list-posts']);
    } finally {
      await client.close();
    }
  });

  test('stops with a message without a key', () => {
    const run = spawnSync(process.execPath, [CLI], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /SOCIALIT_API_KEY is not set/);
    assert.equal(run.stdout, '');
  });

  test('stops with a message when the key is refused', async () => {
    // Not spawnSync: the stand-in server runs in this process and must answer meanwhile.
    const run = await promisify(execFile)(process.execPath, [CLI], {
      env: { PATH: process.env.PATH, SOCIALIT_API_KEY: 'sk_live_wrong', SOCIALIT_MCP_URL: url },
      timeout: 20_000,
    }).catch((error) => error);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /refused the API key \(401\)/);
  });

  test('prints its version and help', () => {
    const version = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.match(help.stdout, /SOCIALIT_API_KEY/);
    assert.match(help.stdout, /SOCIALIT_TOOLSETS/);
  });
});
