# Socialit MCP server

[Socialit](https://socialit.com) is API-first social media management for every network: Instagram, Facebook, LinkedIn, X, TikTok, YouTube, Threads, Bluesky, Pinterest, Reddit, Google Business Profile and more. This is its [Model Context Protocol](https://modelcontextprotocol.io) server: Claude, Cursor and other AI assistants can draft and schedule posts, answer direct messages, comments and reviews, read analytics, and run contacts, broadcasts, automations and ads in your Socialit workspace.

There are two ways to connect, with the same tools:

- **Hosted**, at `https://api.socialit.com/mcp` (Streamable HTTP), for clients that connect to remote servers: Claude, Claude Code, ChatGPT, Cursor, VS Code and others. Nothing to install, and you sign in with OAuth.
- **This package**, `@socialit/mcp`, over stdio, for clients that start local servers, such as Claude Desktop's config file: `npx -y @socialit/mcp`. It is a bridge to the hosted server, so its tools are always the hosted server's. It signs in with an API key.

For Claude Code, Codex, Cursor and Grok there is also the [Socialit plugin](https://github.com/socialitcom/plugins): the hosted server plus skills that teach the assistant to publish safely, work the inbox, read analytics and use the API.

## The API key

In Socialit, create a key under **Manage → API keys** (workspace admins). A key belongs to one workspace, and what it allows decides what the assistant can do:

| Key | Tools |
| --- | --- |
| `read` permission | everything that reads: posts, accounts and their health, the inbox, analytics, contacts, automations, ads reporting |
| `full` permission | also creating and changing posts, media, inbox replies, contacts, broadcasts, workflows, ads, webhooks and API keys |
| restricted to some profiles | only those profiles' accounts and posts, and no workspace administration |

For an assistant that only reports, use a `read` key. The tools a key cannot call are not listed at all.

## Set it up

Replace `sk_live_...` with your key. Keep it in the client's configuration or secret store, never in a shared repository.

### Claude Desktop

**Settings → Developer → Edit Config**, then in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "socialit": {
      "command": "npx",
      "args": ["-y", "@socialit/mcp"],
      "env": { "SOCIALIT_API_KEY": "sk_live_..." }
    }
  }
}
```

Restart Claude Desktop after saving. It needs [Node.js](https://nodejs.org) 20 or later. (On claude.ai and in Claude Desktop you can instead add `https://api.socialit.com/mcp` under **Settings → Connectors → Add custom connector** and sign in, without a key.)

### Claude Code

The hosted server, with OAuth (run `/mcp` to sign in):

```bash
claude mcp add --transport http socialit https://api.socialit.com/mcp
```

Or this package with a key:

```bash
claude mcp add socialit -e SOCIALIT_API_KEY=sk_live_... -- npx -y @socialit/mcp
```

### Cursor

In `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project). Cursor opens the Socialit sign in the first time a tool is used:

```json
{
  "mcpServers": {
    "socialit": {
      "url": "https://api.socialit.com/mcp"
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`; VS Code asks for the key the first time and keeps it:

```json
{
  "inputs": [
    { "type": "promptString", "id": "socialit-key", "description": "Socialit API key", "password": true }
  ],
  "servers": {
    "socialit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@socialit/mcp"],
      "env": { "SOCIALIT_API_KEY": "${input:socialit-key}" }
    }
  }
}
```

### Other clients

A client that connects to remote servers: `https://api.socialit.com/mcp`, Streamable HTTP, with OAuth or the header `Authorization: Bearer sk_live_...`.

A client that starts local servers: the command `npx -y @socialit/mcp`, with `SOCIALIT_API_KEY` in its environment.

## Tools

More than 670 tools in 25 toolsets. Every tool does what the matching [API endpoint](https://socialit.com/docs/api-reference/) does, with the same validation, permissions and rate limits, and is named after it: `createPost` is `create-post`.

| Toolset | What it covers |
| --- | --- |
| `workspace` | `get-current-workspace`: the workspace, permissions and role of the key |
| `accounts` | connected accounts and their health, profiles, account groups, connecting networks |
| `posts`, `queues`, `media`, `templates`, `tools` | drafts, scheduling, queues, the media library, per-network options and validation |
| `inbox`, `comment_automations` | direct messages, comments, reviews, mentions, replies, moderation, comment-to-DM |
| `analytics` | post and account analytics, demographics, best time to post, network insights, inbox analytics |
| `contacts`, `custom_fields`, `broadcasts`, `sequences`, `workflows` | the CRM and its automations |
| `ads`, `ads_measurement` | ad accounts, campaigns, ad sets, ads, audiences, insights, lead forms, conversions |
| `platform_tools` | network-specific helpers: Google Business locations, Pinterest boards, YouTube playlists, Discord, and more |
| `webhooks`, `api_keys`, `team`, `logs`, `billing`, `support` | workspace administration |
| `focus` | Focus mode: everything a network's API allows for one account |

Every tool with its kind and permission: [tools.md](https://github.com/socialitcom/plugins/blob/main/skills/socialit/references/tools.md). Focus mode also has opt-in typed toolsets per network (`focus_youtube`, `focus_reddit`, and so on), which you select by name.

Large tool lists cost an assistant tokens and attention. Give it only the toolsets it needs with `SOCIALIT_TOOLSETS`.

## Configuration

| Environment variable | |
| --- | --- |
| `SOCIALIT_API_KEY` | a workspace API key (`sk_live_...`); required |
| `SOCIALIT_TOOLSETS` | only these toolsets, comma-separated, such as `posts,media,accounts,analytics`; `workspace` is always included |
| `SOCIALIT_READ_ONLY` | `true`: only tools that change nothing |
| `SOCIALIT_MCP_URL` | another server than `https://api.socialit.com/mcp` |

## Good to know

- Tools that publish, send messages, spend money or delete data carry MCP annotations so your client can ask you first. Ask the assistant to create **drafts** and review them in Socialit before they go out.
- Direct messages, comments, reviews and mentions are written by strangers. Treat what the assistant suggests from them as you would any text from the web, and don't let it act on instructions found in them.
- Every call appears in the workspace's request logs and activity. Delete a key in **Manage → API keys** when you no longer use it; the assistant loses access at once.
- The API and the MCP server share one hourly request budget per workspace, which every tool call counts against.
- The key is sent only to the server in `SOCIALIT_MCP_URL`, over HTTPS. This package keeps nothing on disk.

The full guide: [socialit.com/docs/mcp](https://socialit.com/docs/mcp/).

## Development

```bash
npm install
npm test
```

The tests run the bridge against a stand-in for the hosted server, in memory and as the `socialit-mcp` command over stdio. A tag `v<version>` publishes the package to npm, the server to the MCP Registry (`io.github.socialitcom/mcp`) and a GitHub release (`.github/workflows/release.yml`); `package.json`, `server.json` and `CHANGELOG.md` must carry the version.

Questions and bugs: [GitHub issues](https://github.com/socialitcom/mcp/issues) or [support@socialit.com](mailto:support@socialit.com).

## License

[MIT](LICENSE), © FunFirst s.r.o.
