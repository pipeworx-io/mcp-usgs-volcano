# @pipeworx/usgs-volcano

USGS Volcano Hazards Program MCP — alert levels + notices for US volcanoes. No auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

- `list_volcanoes(observatory?)` — every monitored volcano + current alert.
- `list_elevated()` — volcanoes currently above Normal/Green.
- `list_notices(volcano_slug?, limit?)` — recent activity notices.

## Data source

`https://volcanoes.usgs.gov/hans-public/api/` — USGS HANS public feed.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "usgs-volcano": {
      "url": "https://gateway.pipeworx.io/usgs-volcano/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Usgs Volcano data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
