# Normalize IDE tool events → agent-ops v1 schema.
# Usage: jq -c -f normalize-op.jq --arg ts "$TS" --arg origin "$ORIGIN" <<<"$TOOL_DATA"

def first_nonempty:
  [.[] | select(type == "string" and length > 0)] | first // "";

def tool_name:
  first_nonempty([.tool, .tool_name, "unknown"]);

def mcp_parts:
  tool_name as $t
  | if ($t | test("^mcp__")) then
      ($t | ltrimstr("mcp__") | split("__")) as $p
      | { server: ($p[0] // ""), mcp_tool: (if ($p | length) > 1 then $p[1:] | join("__") else "" end) }
    else
      { server: "", mcp_tool: "" }
    end;

{
  schema_version: 1,
  timestamp: $ts,
  origin: $origin,
  tool: tool_name,
  action: first_nonempty([.action, .tool_input.action, .hook_event_name, "unknown"]),
  target: first_nonempty([
    .target,
    .file_path,
    .filePath,
    .path,
    .tool_input.file_path,
    .tool_input.filePath,
    .tool_input.path,
    .tool_input.notebook_path,
    .tool_input.target_directory,
    .tool_input.uri
  ]),
  command: first_nonempty([
    .command,
    .tool_input.command,
    .tool_input.cmd,
    .tool_input.script_command
  ]),
  pattern: first_nonempty([
    .pattern,
    .tool_input.pattern,
    .tool_input.query,
    .tool_input.search_term,
    .tool_input.glob,
    .tool_input.regex
  ]),
  mcp_server: first_nonempty([
    .mcp_server,
    .server,
    (.tool_input.server // ""),
    mcp_parts.server
  ]),
  mcp_tool: first_nonempty([
    .mcp_tool,
    .tool_input.toolName,
    .tool_input.tool,
    mcp_parts.mcp_tool
  ]),
  model: (.model // ""),
  tool_use_id: (.tool_use_id // ""),
  type: "agent-operation"
}
