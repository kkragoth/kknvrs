# ReAct Loop

In `kknvrs`, ReAct = `Reason + Act` loop in `src/lib/agent-loop.ts:140`.

## High Level

1. `Reason:` LLM sees `system + history + userText + tool definitions`, streams text.
2. `Act:` instead of final answer it returns `tool_calls`, e.g. `notebortt-local__board_list`.
3. `Observe:` we execute that tool via MCP, append `role: tool` result back to messages.
4. Repeat until model answers with no `tool_calls` (`done`), or `agent.maxSteps` runs out -> error.

That's it: `model -> tools -> model` until answer.

## Code Walkthrough

`src/lib/agent-loop.ts:140` `runAgentTurn(params)` is an `AsyncGenerator<ChatEvent>` (`src/types.ts:10`):

### 1. Setup: `140-158`

```ts
tools = await listAggregatedTools(clients)
messages = [{role:system,...}, ...history, {role:user,...}]
history.push(user)
ollamaTools = [...toOllamaTools(tools), ...META_TOOLS]
maxSteps = max(1, agent.maxSteps)
```

* `listAggregatedTools`: `src/lib/mcp-manager.ts:179` fans out to all connected MCP `Client`s, namespaces as `<server>__<tool>`.
* `agentSystemPrompt`: `src/lib/agent-loop.ts:18` adds date + rules: `list first, never guess IDs, strip prefix`.
* Two lists kept: `messages` (ephemeral, includes `system`, sent to Ollama) and `history` (mutable, no `system`, persisted to thread by `src/lib/chat-turn.ts:117`).
* `META_TOOLS`: `src/lib/agent-loop.ts:65` synthetic local-only tools `mcp_list_prompts / mcp_get_prompt` so model can discover curated prompts mid-turn.

### 2. One Reasoning Step: `165-180`

Calls `streamOllamaChat` from `src/lib/ollama.ts:75` -> `POST {baseUrl}/api/chat` with `{model, messages, tools, stream:true}`.

That function parses NDJSON line-by-line, yields `{type:token}` for text chunks, buffers `tool_calls`, yields them only on `done:true`. Back in loop:

* `token` -> accumulate `assistantText` + re-`yield` to UI.
* `tool_calls` -> save to `toolCalls`.
* `done` -> break inner stream.

### 3. Termination Check: `187-191`

```ts
if (toolCalls.length === 0) {
  history.push({role:assistant, content:assistantText})
  yield {type:done}; return;
}
```

No tools = final answer.

### 4. Act + Observe: `193-223`

Append `assistant+tool_calls` to both lists (model needs to remember what it asked), then for each `call`:

* `yield {type:tool_call}` -> UI shows spinner `Running X...` in `src/lib/chat-turn.ts:74`.
* `output = await runOneTool(clients, name, args)`:
  * `mcp_list_prompts` -> `listAggregatedPrompts`, format bullet list.
  * `mcp_get_prompt` -> `splitToolName` + `getPromptText`, returns follow-these-instructions text.
  * else -> `callAggregatedTool`: `src/lib/mcp-manager.ts:199` splits prefix, `client.callTool()`, `toolText()` extracts text blocks.
* Errors are caught and turned into `Error: ...` tool output, so model can self-correct, not crash.
* `yield {type:tool_result}` + `messages.push({role:tool, content:output})`.

Loop repeats — next `streamOllamaChat` sees tool outputs.

### 5. Guardrails

* `for(step=0; step<maxSteps; step++)` + final error at `227-230` if never answered.
* `signal?.aborted` checked per-step/per-tool; `AbortError` -> silent `return`, handled as cancel in `src/lib/chat-turn.ts:123`.
* `src/lib/chat-turn.ts:23` `startTurn()` drives it: `connectAgentServers` -> `runAgentTurn()` -> maps `token/tool_call/tool_result/done/error` events to zustand `Turn` transitions in `src/lib/turn.ts:44`.
