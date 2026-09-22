module.exports = {
  id: "todo",
  name: "Todo",
  description: "Track and manage multi-step tasks during coding sessions.",
  hasTools: true,
  prompt: () =>
    "You have `todo_write` and `todo_read` tools to manage a task list. Use them to organize multi-step work: initialize the plan with pending tasks, mark tasks in_progress while working on them, and mark them completed when finished.",
};
