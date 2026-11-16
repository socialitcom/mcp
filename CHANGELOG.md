# Changelog

## 1.0.0

The first release of the Socialit MCP server package, for Socialit v1.

- `@socialit/mcp`: the hosted Socialit MCP server over stdio (`npx -y @socialit/mcp`, `SOCIALIT_API_KEY`), for clients that start local servers, such as Claude Desktop. A bridge: its tools, instructions and answers are the hosted server's, more than 670 tools for publishing, the inbox, analytics, the CRM and automations, ads, webhooks and Focus mode.
- `SOCIALIT_TOOLSETS` and `SOCIALIT_READ_ONLY` narrow the tools, as `?toolsets=` and `?read_only=true` do on the hosted server.
- Listed in the MCP Registry as `io.github.socialitcom/mcp`, with the package and the hosted server, `https://api.socialit.com/mcp` (Streamable HTTP, OAuth or an API key).
