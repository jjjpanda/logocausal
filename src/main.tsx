import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import { viewOptions } from "./view-options";

const options = viewOptions(new URLSearchParams(location.search), /\/embed(?:\/|$)/.test(location.pathname));
const framed = window.self !== window.top;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App options={options} page persist={!options.embed && !framed} />
  </StrictMode>,
);
