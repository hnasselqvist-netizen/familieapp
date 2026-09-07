import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@styles/tokens.css";
import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fant ikke #root i index.html");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
