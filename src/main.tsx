import React from "react";
import ReactDOM from "react-dom/client";
import "highlight.js/styles/github-dark.css";
import "./index.css";
import App from "./App";
import { initTauriBridge } from "./lib/tauri-bridge";
import { useSessionStore } from "./store/session-store";

// 1. Initialize singleton Tauri IPC listener (outside React component tree)
initTauriBridge();

// 2. Bootstrap settings and restore open tabs from localStorage
useSessionStore.getState().bootstrapApp();

// 3. Mount React root
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
