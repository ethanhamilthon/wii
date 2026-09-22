import React, { useState } from "react";
import { useSessionStore } from "@/store/session-store";
import type { ExtensionUIRequest } from "@/types/wii";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Generic renderer for a plugin tool's `ctx.ui.select/confirm/input/editor()`
// call (docs/rpc.md "Extension UI Protocol"). Wii never knows which plugin or
// tool asked \u2014 it just presents the requested dialog shape and forwards the answer.
export const ExtensionUIDialog: React.FC<{ sessionId: string; request: ExtensionUIRequest }> = ({
  sessionId,
  request,
}) => {
  const answer = useSessionStore((state) => state.answerExtensionUIRequest);
  const [text, setText] = useState(request.prefill || "");

  const submit = (response: Record<string, unknown>) => answer(sessionId, response);

  return (
    <div className="rounded-xl border border-border-strong bg-panel p-3 text-sm">
      {request.title && <div className="mb-1.5 font-medium text-foreground">{request.title}</div>}
      {request.message && <div className="mb-2 text-xs text-dim">{request.message}</div>}

      {request.method === "select" && (
        <div className="flex flex-wrap gap-2">
          {(request.options || []).map((opt) => (
            <Button key={opt} type="button" variant="secondary" onClick={() => submit({ value: opt })}>
              {opt}
            </Button>
          ))}
          <Button type="button" variant="secondary" onClick={() => submit({ cancelled: true })}>
            Cancel
          </Button>
        </div>
      )}

      {request.method === "confirm" && (
        <div className="flex gap-2">
          <Button type="button" onClick={() => submit({ confirmed: true })}>
            Yes
          </Button>
          <Button type="button" variant="secondary" onClick={() => submit({ confirmed: false })}>
            No
          </Button>
        </div>
      )}

      {(request.method === "input" || request.method === "editor") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit({ value: text });
          }}
          className="grid gap-2"
        >
          {request.method === "editor" ? (
            <Textarea
              autoFocus
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder}
            />
          ) : (
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder}
              className="h-9 w-full rounded-md border border-border-strong bg-[#171717] px-3 text-sm text-foreground outline-none placeholder:text-faint"
            />
          )}
          <div className="flex gap-2">
            <Button type="submit">Send</Button>
            <Button type="button" variant="secondary" onClick={() => submit({ cancelled: true })}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
