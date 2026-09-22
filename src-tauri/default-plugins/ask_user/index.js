module.exports = {
  id: "ask_user",
  name: "Ask User",
  description: "Lets the agent ask a free-form or multiple-choice question mid-task.",
  hasTools: true,
  prompt: () =>
    "You have an `ask_user` tool. Use it when you genuinely need the human to decide something or provide missing information you cannot infer \u2014 not for things you can figure out yourself. When there are clear alternatives, pass them as `options` so the user can choose with one click.",
};
