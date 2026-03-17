import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { warmUpServer } from "./lib/keep-alive";

// Warm up backend on first visit — zero latency for the visitor
warmUpServer();

// Developer credit — visible in browser devtools console
console.log(
  "%c✈️ Seven Trip — Developed By: MD FAYSAL MAHMUD\n%cTG: https://t.me/theblindsinner1\n%cWhatsApp: +48571424883",
  "color:#1d6ae5;font-size:16px;font-weight:bold;",
  "color:#888;font-size:12px;",
  "color:#888;font-size:12px;"
);

createRoot(document.getElementById("root")!).render(<App />);
