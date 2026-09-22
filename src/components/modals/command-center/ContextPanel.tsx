import React, { useEffect, useState } from "react";
import { DEFAULT_TITLE_PROMPT, useSessionStore } from "@/store/session-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const DEFAULT_PI_SYSTEM_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- Use edit for precise changes (edits[].oldText must match exactly)
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files`;

export const ContextPanel: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const systemPrompt = useSessionStore((state) => state.systemPrompt);
  const saveSystemPromptText = useSessionStore((state) => state.saveSystemPromptText);
  const titlePrompt = useSessionStore((state) => state.titlePrompt);
  const saveTitlePromptText = useSessionStore((state) => state.saveTitlePromptText);

  const [text, setText] = useState("");
  const [titleText, setTitleText] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    // If user has saved prompt, use it; otherwise provide Pi's default prompt
    setText(systemPrompt.trim() ? systemPrompt : DEFAULT_PI_SYSTEM_PROMPT);
  }, [systemPrompt]);

  useEffect(() => {
    setTitleText(titlePrompt.trim() ? titlePrompt : DEFAULT_TITLE_PROMPT);
  }, [titlePrompt]);

  const handleSave = async () => {
    try {
      await saveSystemPromptText(text);
      saveTitlePromptText(titleText);
      setStatus("Saved. Applies to new tabs.");
      onSaved();
    } catch (err) {
      setStatus(String(err));
    }
  };

  const handleResetDefault = () => {
    setText(DEFAULT_PI_SYSTEM_PROMPT);
  };

  const handleResetTitleDefault = () => {
    setTitleText(DEFAULT_TITLE_PROMPT);
  };

  return (
    <div className="flex flex-col select-none text-xs">
      <div className="mb-2 flex items-center justify-between text-dim">
        <span>System prompt</span>
        <button
          type="button"
          onClick={handleResetDefault}
          className="text-[11px] text-faint hover:text-foreground transition-colors"
        >
          Reset to Pi default
        </button>
      </div>

      <Textarea
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter system prompt for Pi…"
        className="min-h-[260px] resize-y text-xs font-mono leading-relaxed"
      />

      <div className="mb-2 mt-5 flex items-center justify-between text-dim">
        <span>Session title prompt</span>
        <button
          type="button"
          onClick={handleResetTitleDefault}
          className="text-[11px] text-faint hover:text-foreground transition-colors"
        >
          Reset to default
        </button>
      </div>

      <Textarea
        rows={4}
        value={titleText}
        onChange={(e) => setTitleText(e.target.value)}
        placeholder="Instructions used to auto-generate the tab title after the first message…"
        className="min-h-[90px] resize-y text-xs font-mono leading-relaxed"
      />

      {/* Added breathing room between input and action button */}
      <div className="mt-5 flex flex-col gap-2">
        <Button
          type="button"
          onClick={handleSave}
          className="h-9 w-full bg-text text-[#111] hover:opacity-85 text-xs font-medium cursor-pointer"
        >
          Save
        </Button>

        {status && <p className="text-[11px] text-faint text-center">{status}</p>}
      </div>
    </div>
  );
};
