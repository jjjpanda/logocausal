import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import App from "./App";
import styles from "./style.css?inline";
import { viewOptions } from "./view-options";

/** An isolated simulation; removing the element stops its timers and worker. */
export class LogocausalNetwork extends HTMLElement {
  static observedAttributes = ["embed", "theme", "speed", "autoplay", "transparent", "autofocus", "width", "height"];
  private root?: Root;
  private mount: HTMLDivElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = styles.replaceAll(":root", ":host")
      .replace(/@media\s*\(max-width:/g, "@container (max-width:") + `
      :host { display: block; width: var(--logocausal-width, 100%); height: var(--logocausal-height, 450px); min-width: 0; container-type: inline-size; }
      .component-root, .app-shell { height: 100%; max-width: none; }
      :host([transparent=""]), :host([transparent="true"]) { background: transparent; }
    `;
    this.mount = document.createElement("div");
    this.mount.className = "component-root";
    shadow.append(style, this.mount);
  }

  connectedCallback() {
    this.root = createRoot(this.mount);
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = undefined;
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    for (const dimension of ["width", "height"] as const) {
      const value = Number(this.getAttribute(dimension));
      if (Number.isFinite(value) && value > 0) {
        const size = `${Math.max(1, Math.round(value))}px`;
        this.style.setProperty(`--logocausal-${dimension}`, dimension === "width"
          ? `min(100%, ${size})` : size);
      } else this.style.removeProperty(`--logocausal-${dimension}`);
    }
    this.root?.render(<App options={viewOptions({ get: name => this.getAttribute(name) })} />);
  }
}

if (!customElements.get("logocausal-network")) customElements.define("logocausal-network", LogocausalNetwork);
