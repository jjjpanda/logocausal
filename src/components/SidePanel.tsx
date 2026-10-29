import { useId } from "react";
import type { ReactNode } from "react";

const tabs = [
  { id: "population", label: "Population" },
  { id: "neuron", label: "Neuron" },
  { id: "guide", label: "Guide" },
] as const;
export type PanelTab = typeof tabs[number]["id"];

export default function SidePanel({ active, onChange, population, neuron, guide }: {
  active: PanelTab; onChange: (tab: PanelTab) => void;
  population: ReactNode; neuron: ReactNode; guide: ReactNode;
}) {
  const id = useId();
  const content = { population, neuron, guide };
  return <aside className="panel side" aria-label="Simulation details">
    <div className="side-tabs" role="tablist" aria-label="Inspector panels" onKeyDown={event => {
      const index = tabs.findIndex(tab => tab.id === active);
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      onChange(tabs[next].id);
      document.getElementById(`${id}-${tabs[next].id}-tab`)?.focus();
    }}>
      {tabs.map(tab => <button key={tab.id} id={`${id}-${tab.id}-tab`} role="tab"
        aria-selected={active === tab.id} aria-controls={`${id}-${tab.id}-panel`}
        tabIndex={active === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} className="side-content" role="tabpanel" id={`${id}-${tab.id}-panel`}
      aria-labelledby={`${id}-${tab.id}-tab`} hidden={active !== tab.id}>{content[tab.id]}</div>)}
  </aside>;
}
