import React, { useEffect, useRef, useState } from "react";
import {
  formatCost,
  formatPath,
  formatTokens,
  getModelMaxContext,
  useSessionStore,
} from "@/store/session-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PauseIcon } from "@radix-ui/react-icons";
import * as tauri from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { ExtensionUIDialog } from "@/components/timeline/ExtensionUIDialog";

export const Composer: React.FC = () => {
  const activeId = useSessionStore((state) => state.activeId);
  const activeSession = useSessionStore((state) => (state.activeId ? state.sessions[state.activeId] : null));
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const enabledModels = useSessionStore((state) => state.enabledModels);
  const setActiveSessionModel = useSessionStore((state) => state.setActiveSessionModel);
  const setActiveSessionReasoningEffort = useSessionStore((state) => state.setActiveSessionReasoningEffort);

  const sessionProvider = multiConfig.providers.find((p) => p.id === activeSession?.providerId);
  const visibleModels = React.useMemo(() => {
    const all = [...new Set([activeSession?.model, ...(sessionProvider?.models || [])].filter(Boolean))] as string[];
    return all.filter((m) => !enabledModels || enabledModels.has(m) || m === activeSession?.model);
  }, [activeSession?.model, sessionProvider?.models, enabledModels]);

  const draft = useSessionStore((state) => (activeId ? state.drafts[activeId] ?? "" : ""));
  const setDraft = useSessionStore((state) => state.setDraft);
  const sendMessage = useSessionStore((state) => state.sendMessage);
  const abortActiveSession = useSessionStore((state) => state.abortActiveSession);

  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [isChangingEffort, setIsChangingEffort] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resolve current git branch for the active project (no-op outside a repo)
  useEffect(() => {
    const path = activeSession?.projectPath;
    if (!path) {
      setGitBranch(null);
      return;
    }
    let cancelled = false;
    tauri.getGitBranch(path).then((branch) => {
      if (!cancelled) setGitBranch(branch);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.projectPath]);

  // Auto-resize textarea (min 42px, max 130px)
  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextH = Math.min(Math.max(el.scrollHeight, 42), 130);
    el.style.height = `${nextH}px`;
    el.style.overflowY = el.scrollHeight > 130 ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustHeight();
  }, [draft]);

  // Keep input focused when active session changes or window refocuses
  useEffect(() => {
    if (activeSession?.alive && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [activeSession?.id]);

  if (!activeSession || !activeSession.alive) {
    return null;
  }

  const isBusy = activeSession.busy;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isBusy) {
      abortActiveSession();
      return;
    }
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (activeId) {
      setDraft(activeId, "");
    }
    sendMessage(trimmed);
    if (textareaRef.current) {
      textareaRef.current.style.height = "42px";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = async (model: string) => {
    if (!model || isChangingModel || model === activeSession?.model) return;
    setIsChangingModel(true);
    try {
      await setActiveSessionModel(model);
    } catch (err) {
      console.error("Failed to change model:", err);
    } finally {
      setIsChangingModel(false);
    }
  };

  const handleEffortChange = async (val: string) => {
    if (!val || isChangingEffort || val === activeSession?.reasoningEffort) return;
    setIsChangingEffort(true);
    try {
      await setActiveSessionReasoningEffort(val);
    } catch (err) {
      console.error("Failed to change effort:", err);
    } finally {
      setIsChangingEffort(false);
    }
  };

  // Stats formatting
  const maxCtx = getModelMaxContext(activeSession?.model);
  const inT = formatTokens(activeSession.inputTokens);
  const outT = formatTokens(activeSession.outputTokens);
  const ctxT = formatTokens(activeSession.contextTokens);
  const maxT = formatTokens(maxCtx);
  const totalIn = activeSession.inputTokens + activeSession.cacheReadTokens;
  const cachePct = totalIn > 0 ? Math.round((activeSession.cacheReadTokens / totalIn) * 100) : 0;
  const costStr = formatCost(activeSession.cost);
  const widgets = Object.values(activeSession.pluginWidgets);
  const aboveWidgets = widgets.filter((widget) => widget.placement === "aboveEditor");
  const belowWidgets = widgets.filter((widget) => widget.placement === "belowEditor");

  const renderWidget = (widget: (typeof widgets)[number]) => (
    <div key={widget.key} className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-dim">
      {widget.lines.map((line, index) => (
        <div key={index} className="whitespace-pre-wrap break-words">{line || " "}</div>
      ))}
    </div>
  );

  return (
    <div className="z-20 shrink-0 bg-bg px-6 pb-4 select-none">
      {(aboveWidgets.length > 0 || activeSession.pendingUIRequest) && (
        <div className="grid gap-2 pb-3">
          {aboveWidgets.map(renderWidget)}
          {activeSession.pendingUIRequest && (
            <ExtensionUIDialog
              key={activeSession.pendingUIRequest.id}
              sessionId={activeSession.id}
              request={activeSession.pendingUIRequest}
            />
          )}
        </div>
      )}

      {/* Plugin UI ends here; composer metadata and input stay visually separate. */}
      <div className="border-t border-border" />

      <form onSubmit={handleSubmit} className="pt-3">
        {/* Input container */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            id="message"
            rows={1}
            placeholder="Message…"
            value={draft}
            onChange={(e) => {
              if (activeId) {
                setDraft(activeId, e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            className="flex min-h-[42px] max-h-[130px] w-full resize-none rounded-lg border border-border-strong bg-[#171717] py-[11px] pl-3 pr-20 text-sm leading-[18px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-border-strong"
          />

          {/* Send / Stop action */}
          <button
            type="submit"
            title={isBusy ? "Stop" : "Send (Enter)"}
            aria-label={isBusy ? "Stop" : "Send"}
            className={cn(
              "absolute bottom-1.5 right-2 flex h-[30px] items-center justify-center rounded px-2 text-xs font-medium transition-colors",
              isBusy
                ? "bg-raised text-foreground hover:bg-border"
                : "bg-transparent text-faint hover:text-foreground",
            )}
          >
            {isBusy ? (
              <PauseIcon className="h-4 w-4" />
            ) : (
              <span className="text-[11px]">Enter ⏎</span>
            )}
          </button>
        </div>

        {/* Bottom controls row: branch/directory on the left, model/stats on the right; both bottom-aligned */}
        <div className="flex items-end justify-between gap-3 pt-3 text-xs">
          {/* Left: git branch (top, if repo), project directory (bottom) */}
          <div className="grid max-w-[35%] justify-items-start gap-0.5">
            {gitBranch && (
              <div className="truncate text-[11px] text-faint" title={gitBranch}>
                {gitBranch}
              </div>
            )}
            <div
              title={activeSession.projectPath || undefined}
              className="truncate text-[11px] text-faint"
            >
              {formatPath(activeSession.projectPath)}
            </div>
          </div>

          {/* Right: Model + effort selects (top), token stats (bottom) */}
          <div className="grid max-w-[65%] justify-items-end gap-0.5 text-right">
            <div className="flex items-center gap-2">
              <Select
                value={activeSession?.model || (visibleModels[0] ?? "")}
                onValueChange={handleModelChange}
                disabled={isChangingModel}
              >
                <SelectTrigger
                  aria-label="Model"
                  className="h-6 gap-1 px-1 text-xs text-dim hover:text-foreground focus:ring-0"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent side="top" align="end">
                  {visibleModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={activeSession?.reasoningEffort || "medium"}
                onValueChange={handleEffortChange}
                disabled={isChangingEffort}
              >
                <SelectTrigger
                  aria-label="Reasoning effort"
                  className="h-6 gap-1 px-1 text-xs text-dim hover:text-foreground focus:ring-0 capitalize"
                >
                  <SelectValue placeholder="Effort" />
                </SelectTrigger>
                <SelectContent side="top" align="end">
                  <SelectItem value="off">off</SelectItem>
                  <SelectItem value="minimal">minimal</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="xhigh">xhigh</SelectItem>
                  <SelectItem value="max">max</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="whitespace-nowrap text-[11px] text-faint">
              ↑{inT} ↓{outT} · {ctxT}/{maxT} · cache: {cachePct}% · {costStr}
            </div>
          </div>
        </div>
      </form>

      {belowWidgets.length > 0 && <div className="grid gap-2 pt-2">{belowWidgets.map(renderWidget)}</div>}
    </div>
  );
};
