import React, { useLayoutEffect, useRef } from "react";
import { useSessionStore } from "@/store/session-store";
import { AssistantCard, ErrorCard, UserCard } from "./MessageCard";

export const Timeline: React.FC = () => {
  const activeSession = useSessionStore((state) => state.getActiveSession());

  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const messages = activeSession?.messages || [];

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 72;
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, activeSession?.id]);

  if (!activeSession) {
    return <main className="flex-1 overflow-hidden" />;
  }

  return (
    <main
      ref={containerRef}
      onScroll={handleScroll}
      id="timeline"
      className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-6 scroll-smooth select-text"
    >
      {messages.map((msg, idx) => {
        if (msg.role === "user") {
          return (
            <UserCard
              key={msg.id}
              message={msg}
            />
          );
        }

        if (msg.role === "assistant") {
          return <AssistantCard key={msg.id} message={msg} />;
        }

        if (msg.role === "error") {
          return <ErrorCard key={msg.id} text={msg.text} />;
        }

        return null;
      })}

      {activeSession.busy && !activeSession.pendingUIRequest && (
        <div className="mb-3.5 flex items-center gap-2 text-xs text-faint">
          <span className="h-1.5 w-1.5 animate-[pulse_1.1s_ease-in-out_infinite] rounded-full bg-green" />
          <span className="animate-[pulse_1.1s_ease-in-out_infinite]">Cooking…</span>
        </div>
      )}
    </main>
  );
};
