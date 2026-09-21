import React, { useEffect, useState } from "react";
import { useSessionStore } from "@/store/session-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const ContextPanel: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const systemPrompt = useSessionStore((state) => state.systemPrompt);
  const saveSystemPromptText = useSessionStore((state) => state.saveSystemPromptText);

  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setText(systemPrompt);
  }, [systemPrompt]);

  const handleSave = async () => {
    try {
      await saveSystemPromptText(text);
      setStatus("Saved. Applies to new tabs.");
      onSaved();
    } catch (err) {
      setStatus(String(err));
    }
  };

  return (
    <div className="grid gap-3 select-none text-xs">
      <label className="grid gap-1.5 text-dim">
        System prompt
        <Textarea
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave empty to use Pi's default coding assistant prompt"
          className="text-xs font-mono"
        />
      </label>

      <Button
        type="button"
        onClick={handleSave}
        className="h-9 bg-text text-[#111] hover:opacity-85 text-xs"
      >
        Save
      </Button>

      {status && <p className="text-[11px] text-faint">{status}</p>}
    </div>
  );
};
