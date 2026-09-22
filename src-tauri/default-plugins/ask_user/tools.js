// Real pi extension (loaded via explicit --extension, never discovery).
// Runs INSIDE the pi process, not in Wii's webview.
module.exports = function (pi) {
  pi.registerTool({
    name: "ask_user",
    description: "Ask the human a question and wait for an answer. Provide options when the user should choose one; omit them for free-form input.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask the user." },
        options: {
          type: "array",
          description: "Optional choices the user can select from.",
          items: { type: "string" }
        },
      },
      required: ["question"],
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "(no UI available to ask the user; proceed with your best judgment)" }],
          details: {},
        };
      }
      const options = Array.isArray(params.options)
        ? params.options.map(String).filter(Boolean)
        : [];
      const answer = options.length > 0
        ? await ctx.ui.select(params.question, options)
        : await ctx.ui.input(params.question, "Type your answer\u2026");
      return {
        content: [{ type: "text", text: answer == null ? "(user did not answer)" : answer }],
        details: { answer, options },
      };
    },
  });
};
