import { useEffect, useId, useMemo, useRef, useState } from "react";
import { randomModel, remapState, removeNode, validateModel } from "./core/model";
import type { BinaryNode, NetworkModel } from "./core/model";
import type { TierScore } from "./core/recursion";
import { groupBits, remapScores } from "./core/recursion";
import { HISTORY, START_ENERGY, liveLoop, resizeWorld, worldBounds } from "./core/evolve";
import type { Bounds, Energy, World } from "./core/evolve";
import { influences as influenceMatrix } from "./core/info";
import NetworkGraph, { groupName } from "./components/NetworkGraph";
import type { Bodies } from "./components/NetworkGraph";
import NeuronInspector from "./components/NeuronInspector";
import type { Frame, RecordedEvent } from "./core/history";
import { separate } from "./core/physics";
import { initialWorld, tickSimulation } from "./core/simulation";
import Vitals from "./components/Vitals";
import GroupMachine from "./components/GroupMachine";
import SidePanel from "./components/SidePanel";
import type { PanelTab } from "./components/SidePanel";
import SimulationGuide from "./components/SimulationGuide";
import useLeadingGroup from "./useLeadingGroup";
import type { Vital } from "./components/Vitals";
import { HALF_COLORS, TIER_LABEL, TIER_TERM } from "./tiers";
import { DRAFT_KEY, parseDraft, serializeDraft } from "./draft";
import type { ViewOptions } from "./view-options";
import { viewOptions } from "./view-options";
import useAnalysis from "./useAnalysis";
import favicon from "../public/favicon.svg?inline";

const bits = (value: number) => value.toFixed(2);
const LOGGED = 96;

const startWorld = (previous: World) => {
  const bounds = worldBounds(previous);
  return { ...resizeWorld(initialWorld(), bounds), sun: bounds.width / 2, minimumNeuronRadius: previous.minimumNeuronRadius };
};

const randomState = (model: NetworkModel) => Math.floor(Math.random() * 2 ** model.nodes.length);
const randomPopulation = () => randomModel(6, Math.floor(Math.random() * 0xffffffff) || 1);

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return parseDraft(raw);
  } catch {
    // Fall back to a fresh random population when saved data is unavailable or invalid.
  }
  return randomPopulation();
}

export default function App({ options = viewOptions(new URLSearchParams()), page = false, persist = false }: {
  options?: ViewOptions;
  page?: boolean;
  persist?: boolean;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const randomDialog = useRef<HTMLDialogElement>(null);
  const randomDialogId = useId();
  const [startup] = useState(() => persist ? restoreDraft() : randomPopulation());
  const [model, setModel] = useState<NetworkModel>(startup);
  const [history, setHistory] = useState(() => [randomState(startup)]);
  const [tick, setTick] = useState(0);
  const [generation, setGeneration] = useState(0);
  const [running, setRunning] = useState(options.autoplay);
  const [dark, setDark] = useState(options.theme === "dark");
  const [world, setWorld] = useState(initialWorld);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [energy, setEnergy] = useState<Energy>(() => Object.fromEntries(startup.nodes.map(node => [node.id, START_ENERGY])));
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [speed, setSpeed] = useState(options.speed);
  const { analysis, error: analysisError, retry: retryAnalysis } = useAnalysis(model, generation);
  const [selectedId, setSelectedId] = useState<string | null>(startup.nodes[0]?.id ?? null);
  const [panel, setPanel] = useState<PanelTab>("population");
  const [error, setError] = useState("");
  const bodies = useRef<Bodies>(new Map());
  const influences = useMemo(() => influenceMatrix(model), [model]);
  const tiers = useMemo(() => analysis ? remapScores(analysis.tiers, analysis.model, model) : null, [analysis, model]);
  const fresh = analysis?.model === model;
  const state = history[history.length - 1];
  const habitatBounds = useRef(worldBounds(world));
  habitatBounds.current = worldBounds(world);
  const habitatRadius = useRef(world.minimumNeuronRadius ?? 0);
  habitatRadius.current = world.minimumNeuronRadius ?? 0;

  const resizeHabitat = (bounds: Bounds, minimumNeuronRadius: number) => {
    const previous = habitatBounds.current;
    if (Math.abs(previous.width - bounds.width) < 0.1 && Math.abs(previous.height - bounds.height) < 0.1 && Math.abs(habitatRadius.current - minimumNeuronRadius) < 0.1) return;
    habitatBounds.current = bounds;
    habitatRadius.current = minimumNeuronRadius;
    for (const body of bodies.current.values()) {
      body.x *= bounds.width / previous.width;
      body.y *= bounds.height / previous.height;
      body.vx *= bounds.width / previous.width;
      body.vy *= bounds.height / previous.height;
    }
    separate(model, bodies.current, { ...world, bounds, minimumNeuronRadius }, undefined, 32);
    setWorld(current => ({ ...resizeWorld(current, bounds), minimumNeuronRadius }));
  };

  useEffect(() => setDark(options.theme === "dark"), [options.theme]);
  useEffect(() => setRunning(options.autoplay), [options.autoplay]);
  useEffect(() => setSpeed(options.speed), [options.speed]);

  useEffect(() => {
    if (page) {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.dataset.transparent = String(options.transparent);
    }
  }, [dark, page, options.transparent]);

  useEffect(() => {
    if (options.autofocus) shell.current?.focus();
  }, [options.autofocus]);

  useEffect(() => {
    if (!persist) return;
    try {
      if (model.nodes.length) localStorage.setItem(DRAFT_KEY, serializeDraft(model));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Saving is optional when browser storage is unavailable.
    }
  }, [model, persist]);

  const change = (next: NetworkModel) => {
    try {
      validateModel(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid model.");
      return;
    }
    setError("");
    setModel(next);
    const remap = (mask: number) => remapState(mask, model, next);
    setHistory((h) => h.map(remap));
  };

  const loops = tiers?.filter((s) => s.tier === "consciousness") ?? [];
  const strength = (s: TierScore, h = history) => liveLoop(s, h, model.nodes.length);

  const advance = () => {
    const life = tickSimulation({ model, history, energy, world }, bodies.current, fresh ? tiers : null, Math.random, 0.002, influences);
    const { signals: h, timing } = life;
    setHistory(life.history);
    setTick((t) => t + 1);
    setVitals((list) => [...list, { neurons: model.nodes.length, loop: Math.max(0, ...loops.map((s) => strength(s, h))) }].slice(-HISTORY));
    setEnergy(life.energy);
    setWorld(life.world);
    setFrames(list => [...list, { tick: tick + 1, neurons: Object.fromEntries(model.nodes.map((node, i) => [node.id, {
      node, readIds: node.inputs.map(j => model.nodes[j].id), signal: !!((h[h.length - 1] >>> i) & 1),
      on: timing[i].active && !!((h[h.length - 1] >>> i) & 1), energy: life.energy[node.id] ?? 0,
      heat: life.budgets[i].heat, budget: life.budgets[i],
    }])) }].slice(-HISTORY));
    if (life.events.length) setEvents((list) => [...life.events.map((e) => ({ ...e, tick: tick + 1,
      id: (e.kind === "born" ? life.model : model).nodes.find(n => n.label === e.label)!.id,
      parentId: model.nodes.find(n => n.label === e.parent)?.id,
    })), ...list].slice(0, LOGGED));
    setModel(life.model);
  };
  const actions = useRef({ advance });
  actions.current = { advance };

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => actions.current.advance(), 1000 / speed);
    return () => clearTimeout(timer);
  }, [running, speed, tick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (randomDialog.current?.open) return;
      const target = event.composedPath()[0];
      if (!(target instanceof HTMLElement || target instanceof SVGElement)) return;
      if (!shell.current?.contains(target) && !(page && (target === document.body || target === document.documentElement))) return;
      if (target.closest("input, select, textarea, button, [role=button], [contenteditable]")) return;
      if (event.key === " ") setRunning((r) => !r);
      else if (event.key === "s") actions.current.advance();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page]);

  const updateNode = (index: number, node: BinaryNode) =>
    change({ ...model, nodes: model.nodes.map((n, i) => (i === index ? node : n)) });

  const resetPopulation = (next: NetworkModel) => {
    bodies.current.clear();
    setEnergy(Object.fromEntries(next.nodes.map((n) => [n.id, START_ENERGY])));
    setModel(next);
    setHistory([randomState(next)]);
    setSelectedId(next.nodes[0]?.id ?? null);
    setTick(0);
    setGeneration(value => value + 1);
    setEvents([]);
    setFrames([]);
    setVitals([]);
    setWorld(startWorld);
    setError("");
  };
  const generateRandom = () => {
    resetPopulation(randomPopulation());
    randomDialog.current?.close();
  };
  const requestRandom = () => {
    if (!model.nodes.length) {
      generateRandom();
      return;
    }
    randomDialog.current?.showModal();
  };

  const { focus } = useLeadingGroup(model, tiers, fresh, running, generation);
  const finding = !tiers ? "Analysing…" : focus ? `${bits(groupBits(focus))} bit` : "No group";
  const rows =
    focus?.tier === "consciousness"
      ? [
          { mask: focus.model, color: HALF_COLORS[0] },
          { mask: focus.record, color: HALF_COLORS[1] },
        ]
      : focus
        ? [{ mask: focus.mask, color: "#ffd93d" }]
        : [];
  const outlines = rows.map(row => ({ ...row, bold: true }));
  const neuron = selectedId === null ? -1 : model.nodes.findIndex((node) => node.id === selectedId);
  const half = (mask: number, k: number) => <b style={{ color: HALF_COLORS[k] }}>{groupName(model, mask)}</b>;

  return (
    <div ref={shell} className={`app-shell${options.embed ? " embed-view" : ""}`} data-theme={dark ? "dark" : "light"} data-transparent={options.transparent} tabIndex={0} aria-label="Logocausal simulation">
      {!options.embed && <header className="app-header">
        <span className="brand" aria-label="Logocausal">
          <span className="brand-mark" aria-hidden="true">
            <img src={favicon} alt="" width="26" height="26" />
          </span>
        </span>
        <div className="transport" role="toolbar" aria-label="Simulation">
          <button className="primary-button" onClick={() => setRunning(!running)}>
            {running ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button onClick={advance} disabled={running}>Step</button>
          <button onClick={requestRandom}>Random gen</button>
          <label className="slider">
            speed <b>{speed}/s</b>
            <input type="range" min={1} max={12} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
        </div>
        <label className="theme-toggle" title={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <input type="checkbox" aria-label="Dark mode" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {dark ? <path d="M20.5 14.2A9 9 0 0 1 9.8 3.5a9 9 0 1 0 10.7 10.7Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
          </svg>
        </label>
      </header>}
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {analysisError && <div className="error" role="alert">{analysisError}<button onClick={retryAnalysis}>Retry analysis</button></div>}
        <div className="stage">
          <section className="panel graph-panel" aria-label="Network">
            {!options.embed && <div className="habitat-heading"><h1>Network</h1><div className="hud" aria-live="off">
              T{String(tick).padStart(4, "0")} · {model.nodes.filter((_, i) => (state >>> i) & 1).length}/{model.nodes.length} ON
              {running ? "" : " · PAUSED"}
            </div></div>}
            <div className="habitat-canvas">
            <NetworkGraph
              model={model}
              influences={influences}
              bodies={bodies.current}
              history={history}
              energy={energy}
              world={world}
              tick={tick}
              period={1000 / speed}
              running={running}
              onResize={resizeHabitat}
              outlines={outlines}
              focus={focus}
              selectedNeuron={neuron < 0 ? null : neuron}
              onNeuron={(i) => { setSelectedId(model.nodes[i].id); setPanel("neuron"); }}
            />
            {!model.nodes.length && <div className="habitat-empty"><h2>No neurons.</h2><p>Generate a population to run the simulation.</p><button className="primary-button" onClick={requestRandom}>Random gen</button></div>}
            </div>
          </section>

          {!options.embed && <SidePanel active={panel} onChange={setPanel} population={
            <section className="panel groups-panel" aria-label="Population">
              <div className="panel-heading"><h2>Population</h2></div>
              <div className="group-content">
              <Vitals vitals={vitals} />
              <div className="history-heading"><h3>{running ? "Leading group" : "Top-ranked group"}</h3><span role="status" aria-label="Finding">{finding}</span></div>
              {focus && <div className="group-summary"><strong>{groupName(model, focus.mask)}</strong><span className={`tier tier-${focus.tier}`} title={TIER_TERM[focus.tier]}>{TIER_LABEL[focus.tier]}</span></div>}
              <div className="focus" aria-label="Displayed group">
                {focus?.tier === "consciousness" ? (
                  <>
                    {half(focus.model, 0)} → {half(focus.record, 1)} {bits(focus.modelToRecord)} · {half(focus.record, 1)} →{" "}
                    {half(focus.model, 0)} {bits(focus.recordToModel)} · now <b>{bits(strength(focus))}</b> bit
                  </>
                ) : focus?.tier === "awareness" ? (
                  <>Self-predicting {bits(focus.awareness)} bit · no loop</>
                ) : (
                  <>No group carries its past.</>
                )}
              </div>
              <p className="hint leader-note" title="A challenger needs a 2-second lead of at least 0.05 bit or 10%. Feedback loops rank above self-predicting groups. Missing ranking entries keep their reading interval while their neurons live. Pausing shows the exact ranking.">{running ? "Stable view · pause for exact ranking" : "Exact ranking · paused"}</p>
              {focus && <GroupMachine key={generation} model={model} mask={focus.mask} running={running} frames={frames} circuits={fresh ? analysis.circuits : []} />}
              <div className="history-heading population-history"><h3>Population history</h3></div>
              {events.length ? <ol className="log" aria-label="Life log">{events.map((e, k) => <li key={k} className={e.kind}><span>T{e.tick}</span> {e.kind === "born" ? `${e.parent} → ${e.label}` : `${e.label} ${e.cause}`}</li>)}</ol> : <p className="hint">No births or deaths yet.</p>}
              </div>
            </section>
          } neuron={
            <NeuronInspector model={model} selectedId={selectedId} onSelect={setSelectedId}
              history={history} energy={energy} world={world} bodies={bodies.current} frames={frames} events={events}
              onChange={updateNode} onRemove={(index) => change(removeNode(model, index))} />
          } guide={<SimulationGuide />} />}
        </div>
      </main>
      <dialog ref={randomDialog} className="random-dialog" aria-labelledby={`${randomDialogId}-title`} aria-describedby={`${randomDialogId}-description`}>
        <h2 id={`${randomDialogId}-title`}>Generate a random population?</h2>
        <p id={`${randomDialogId}-description`}>This replaces the current network with six random neurons and clears the simulation history.</p>
        <form method="dialog" className="dialog-actions">
          <button autoFocus>Cancel</button>
          <button type="button" className="primary-button" onClick={generateRandom}>Generate</button>
        </form>
      </dialog>
    </div>
  );
}
