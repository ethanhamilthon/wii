import { listen } from "@tauri-apps/api/event";
import { useSessionStore } from "@/store/session-store";

let bridgeInitialized = false;

export async function initTauriBridge(): Promise<void> {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  try {
    await listen<{ sessionId: string; event: any }>("pi-event", ({ payload }) => {
      useSessionStore.getState().handlePiEvent(payload.sessionId, payload.event);
    });

    await listen<{ sessionId: string; message: string }>("pi-stderr", ({ payload }) => {
      useSessionStore.getState().handlePiStderr(payload.sessionId, payload.message);
    });

    await listen<{ sessionId: string; status: any }>("pi-exit", ({ payload }) => {
      useSessionStore.getState().handlePiExit(payload.sessionId, payload.status);
    });
  } catch (error) {
    // In standalone browser/smoke test mode, listen() throws because Tauri core is not present.
    // Allow graceful fallback without breaking app render.
    console.warn("Tauri event bridge unavailable (browser mode?):", error);
  }
}
