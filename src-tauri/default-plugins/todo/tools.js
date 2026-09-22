// Real pi extension (loaded via explicit --extension, never discovery).
// Runs INSIDE the pi process, not in Wii's webview.
let todos = [];

module.exports = function (pi) {
  const normalize = (items) => (Array.isArray(items) ? items : []).map((t, idx) => ({
    id: String(t.id != null ? t.id : idx + 1),
    content: String(t.content || ""),
    status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending"
  }));

  const showWidget = (ctx) => {
    if (todos.length === 0) {
      ctx.ui.setWidget("todo", undefined);
      return;
    }
    const done = todos.filter((t) => t.status === "completed").length;
    const current = todos.find((t) => t.status === "in_progress");
    const next = todos.find((t) => t.status === "pending");
    const focus = current
      ? `→ #${current.id} ${current.content}`
      : next
        ? `Next · #${next.id} ${next.content}`
        : "✓ All tasks completed";
    ctx.ui.setWidget("todo", [`Todo · ${done}/${todos.length}`, focus], { placement: "aboveEditor" });
  };

  const restore = (ctx) => {
    todos = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "wii-todo-state") {
        todos = normalize(entry.data && entry.data.todos);
      } else if (entry.type === "message" && entry.message && entry.message.role === "toolResult" &&
                 (entry.message.toolName === "todo_write" || entry.message.toolName === "todo_read") &&
                 entry.message.details) {
        todos = normalize(entry.message.details.todos);
      }
    }
    showWidget(ctx);
  };

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.registerTool({
    name: "todo_write",
    description: "Update the todo list. Replaces current list with the provided array of items. Use this to track multi-step progress, add tasks, or update their statuses.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Complete list of todo items.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier for task (e.g. '1', '2')." },
              content: { type: "string", description: "Description of the task." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Task status: 'pending', 'in_progress', or 'completed'."
              }
            },
            required: ["id", "content", "status"]
          }
        }
      },
      required: ["todos"]
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      todos = normalize(params && params.todos);
      pi.appendEntry("wii-todo-state", { todos });
      showWidget(ctx);

      const summary = todos.map(t => {
        const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[-]" : "[ ]";
        return `${mark} #${t.id}: ${t.content} (${t.status})`;
      }).join("\n");

      return {
        content: [{ type: "text", text: todos.length === 0 ? "Todo list cleared." : `Todo list updated (${todos.length} items):\n${summary}` }],
        details: { todos }
      };
    }
  });

  pi.registerTool({
    name: "todo_read",
    description: "Read the current list of todo items and their statuses.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      showWidget(ctx);
      if (todos.length === 0) {
        return {
          content: [{ type: "text", text: "Todo list is empty." }],
          details: { todos: [] }
        };
      }

      const summary = todos.map(t => {
        const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[-]" : "[ ]";
        return `${mark} #${t.id}: ${t.content} (${t.status})`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `Current todo list (${todos.length} items):\n${summary}` }],
        details: { todos }
      };
    }
  });
};
