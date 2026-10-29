type SymbolKind = "cell" | "bars" | "signal" | "energy" | "food" | "sun" | "group";

function GuideSymbol({ kind }: { kind: SymbolKind }) {
  return <svg className={`guide-symbol guide-symbol-${kind}`} viewBox="0 0 40 28" aria-hidden="true">
    {kind === "cell" && <><circle cx="20" cy="14" r="10" fill="var(--accent)" stroke="var(--ink)" /><circle cx="20" cy="14" r="3" fill="var(--accent-ink)" /></>}
    {kind === "bars" && Array.from({ length: 12 }, (_, i) => <rect key={i} x={2 + i * 3} y={9} width="2" height="10" fill={[1, 2, 5, 8, 9, 11].includes(i) ? "var(--accent)" : "var(--line)"} />)}
    {kind === "signal" && <><path d="M3 14h31m-5-5 5 5-5 5" fill="none" stroke="var(--muted)" strokeWidth="1.5" /><circle cx="13" cy="14" r="2" fill="var(--accent)" /><circle cx="20" cy="14" r="3" fill="var(--accent)" /></>}
    {kind === "energy" && <><circle cx="20" cy="14" r="10" fill="none" stroke="var(--line)" strokeWidth="2" /><path d="M20 4a10 10 0 1 1-10 10" fill="none" stroke="var(--cold)" strokeWidth="3" strokeLinecap="round" /></>}
    {kind === "food" && <><circle cx="20" cy="14" r="11" fill="#0a9d6220" stroke="#0a9d62" /><circle cx="20" cy="14" r="5" fill="#0a9d6230" /></>}
    {kind === "sun" && <g fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinecap="round"><circle cx="20" cy="14" r="6" fill="var(--sun)" /><path d="M20 2v2m0 20v2M8 14h2m20 0h2M11.5 5.5 13 7m14 14 1.5 1.5m-17 0L13 21M27 7l1.5-1.5" /></g>}
    {kind === "group" && <><rect x="2" y="5" width="18" height="18" rx="7" fill="none" stroke="#4477ff" strokeWidth="2" strokeDasharray="3 2" /><rect x="20" y="5" width="18" height="18" rx="7" fill="none" stroke="#ff4466" strokeWidth="2" strokeDasharray="3 2" /></>}
  </svg>;
}

const legend: { kind: SymbolKind; label: string; note: string }[] = [
  { kind: "cell", label: "Gold = activity", note: "Slow / paused: on. Fast: recent signal start." },
  { kind: "bars", label: "Bars = last 12 ticks", note: "Oldest → newest" },
  { kind: "signal", label: "Arrows = signal direction", note: "Moving dots trace recent signal starts." },
  { kind: "energy", label: "Arc = stored energy", note: "Blue: cold · red: hot" },
  { kind: "food", label: "Green = food", note: "Fades as food runs out." },
  { kind: "sun", label: "Sun = warmth", note: "Food regrows in light." },
  { kind: "group", label: "Blue / red = loop halves", note: "Two groups predicting each other." },
];

export default function SimulationGuide() {
  return <section className="guide-panel" aria-label="Simulation guide">
    <div className="panel-heading"><h2>Quick guide</h2></div>
    <div className="panel-scroll">
      <dl className="guide-actions" aria-label="Explore">
        <div><dt>Click</dt><dd>Inspect</dd></div>
        <div><dt>Drag</dt><dd>Move</dd></div>
        <div><dt>Pause</dt><dd>Read signals</dd></div>
      </dl>
      <h3>Visual key</h3>
      <dl className="visual-key">
        {legend.map(item => <div key={item.kind}>
          <dt><GuideSymbol kind={item.kind} /><span>{item.label}</span></dt>
          <dd>{item.note}</dd>
        </div>)}
      </dl>
      <div className="guide-life" aria-label="Life cycle">
        <div className="guide-flow"><span>Food</span><b aria-hidden="true">→</b><span>Energy</span><b aria-hidden="true">→</b><span>Division</span></div>
        <div className="guide-life-notes"><span>2.2 energy → divide</span><span>0 energy → die</span></div>
      </div>
      <details><summary>Cells & rules</summary>
        <dl className="guide-facts">
          <div><dt>Logic</dt><dd>Inputs → gate → on / off</dd></div>
          <div><dt>Sensors</dt><dd>Read food or light.</dd></div>
          <div><dt>Movers</dt><dd>Push toward food or comfortable warmth.</dd></div>
          <div><dt>Rest</dt><dd>3 firings in a row → 1 update off</dd></div>
          <div><dt>Energy</dt><dd>Food adds it; living and firing spend it. Links share it.</dd></div>
          <div><dt>Weather</dt><dd>Cold slows. Overheating costs energy.</dd></div>
          <div><dt>Evolution</dt><dd>Links, gates and roles can change. Children usually inherit them.</dd></div>
        </dl>
      </details>
      <details><summary>Scores & machines</summary>
        <dl className="guide-facts">
          <div><dt>Bits</dt><dd>How well a group's state predicts its next state.</dd></div>
          <div><dt>Type</dt><dd>What the gates can do with outside inputs held steady.</dd></div>
          <div><dt>Live</dt><dd>Observed signals, including fatigue, cold and noise.</dd></div>
          <div><dt>Stability</dt><dd>Groups need a 2-second lead of ≥0.05 bit or 10%, whichever is larger. Missing groups are replaced immediately; types settle for 1.5 seconds.</dd></div>
          <div><dt>Pause</dt><dd>Exact current ranking and machine type.</dd></div>
        </dl>
      </details>
      <details><summary>Charts & keys</summary>
        <dl className="guide-facts">
          <div><dt>Neurons</dt><dd>Living cells.</dd></div>
          <div><dt>Best loop</dt><dd>Strongest observed two-way feedback.</dd></div>
          <div><dt>History</dt><dd>Last 96 ticks; resets with a new population.</dd></div>
          <div><dt><kbd>Space</kbd></dt><dd>Play / pause</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Step (away from controls)</dd></div>
        </dl>
      </details>
    </div>
  </section>;
}
