import { useEffect, useMemo, useRef, useState } from "react";
import { emptyModel, randomModel, remapState, removeNode, validateModel } from "./core/model";
import type { BinaryNode, NetworkModel } from "./core/model";
import type { TierScore } from "./core/recursion";
import { groupBits } from "./core/recursion";
import { FOOD_START_AMOUNT, HISTORY, LIGHT_RANGE, START_ENERGY, W, live, liveLoop, processTiming, resizeWorld, step, worldBounds } from "./core/evolve";
import type { Bounds, Energy, World } from "./core/evolve";
import { influences as influenceMatrix } from "./core/info";
import NetworkGraph, { groupName } from "./components/NetworkGraph";
import type { Bodies } from "./components/NetworkGraph";
import NeuronInspector from "./components/NeuronInspector";
import type { Frame, RecordedEvent } from "./components/NeuronInspector";
import { place, separate, settle } from "./core/physics";
import Vitals from "./components/Vitals";
import GroupMachine from "./components/GroupMachine";
import SidePanel from "./components/SidePanel";
import type { PanelTab } from "./components/SidePanel";
import SimulationGuide from "./components/SimulationGuide";
import useLeadingGroup from "./useLeadingGroup";
import type { Vital } from "./components/Vitals";
import { HALF_COLORS, TIER_LABEL, TIER_TERM } from "./tiers";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";
import { DRAFT_KEY, parseDraft, serializeDraft } from "./draft";

const initial = emptyModel();
const bits = (value: number) => value.toFixed(2);
const LOGGED = 96;
const NOISE = 0.002;
const START_WORLD: World = {
  sun: W / 2,
  food: [
    { x: W / 2 - 550, y: 240, amount: FOOD_START_AMOUNT },
    { x: W / 2, y: 600, amount: FOOD_START_AMOUNT },
    { x: W / 2 + 550, y: 240, amount: FOOD_START_AMOUNT },
  ],
};

const startWorld = (previous: World) => {
  const bounds = worldBounds(previous);
  return { ...resizeWorld(START_WORLD, bounds), sun: bounds.width / 2, minimumNeuronRadius: previous.minimumNeuronRadius };
};

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return parseDraft(raw);
  } catch {
    return initial;
  }
  return initial;
}

const randomState = (model: NetworkModel) => Math.floor(Math.random() * 2 ** model.nodes.length);

export default function App() {
  const [startup] = useState(restoreDraft);
  const [model, setModel] = useState<NetworkModel>(startup);
  const [history, setHistory] = useState(() => [randomState(startup)]);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);
  const [dark, setDark] = useState(true);
  const [world, setWorld] = useState(START_WORLD);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [energy, setEnergy] = useState<Energy>({});
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [speed, setSpeed] = useState(3);
  const [analysis, setAnalysis] = useState<{ model: NetworkModel; tiers: TierScore[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(startup.nodes[0]?.id ?? null);
  const [panel, setPanel] = useState<PanelTab>("population");
  const [error, setError] = useState("");
  const bodies = useRef<Bodies>(new Map());
  const influences = useMemo(() => influenceMatrix(model), [model]);
  const tiers = analysis?.tiers ?? null;
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

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, serializeDraft(model));
    } catch {
      // Saving is optional when browser storage is unavailable.
    }
  }, [model]);

  const worker = useRef<{ task: Worker; busy: boolean } | null>(null);
  useEffect(() => () => worker.current?.task.terminate(), []);
  useEffect(() => {
    if (!worker.current || worker.current.busy) {
      worker.current?.task.terminate();
      worker.current = { task: new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }), busy: false };
    }
    const current = worker.current;
    current.busy = true;
    current.task.onmessage = (event: MessageEvent<WorkerResponse>) => {
      current.busy = false;
      if ("tiers" in event.data) {
        const found = event.data.tiers;
        setAnalysis({ model, tiers: found });
      } else setError(event.data.error);
    };
    current.task.onerror = () => {
      worker.current = null;
      setError("The analysis worker failed. Edit the network to try again.");
    };
    current.task.postMessage(model satisfies WorkerRequest);
  }, [model]);

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
    setAnalysis(
      (a) =>
        a && {
          model: a.model,
          tiers: a.tiers
            .map((s) => ({ ...s, mask: remap(s.mask), model: remap(s.model), record: remap(s.record) }))
            .filter((s) => (s.tier === "consciousness" ? s.model && s.record : s.mask)),
        },
    );
  };

  const loops = tiers?.filter((s) => s.tier === "consciousness") ?? [];
  const strength = (s: TierScore, h = history) => liveLoop(s, h, model.nodes.length);

  const advance = () => {
    const bounds = worldBounds(world);
    const locate = (id: string) => bodies.current.get(id) ?? { x: bounds.width / 2, y: Math.min(bounds.height / 2, LIGHT_RANGE * 0.45) };
    place(model, bodies.current, world);
    for (let frame = 0; frame < 20; frame++) settle(model, influences, bodies.current, state, world);
    const timing = processTiming(model, history, world, locate);
    const h = [...history, step(model, history, world, locate, NOISE, Math.random, timing)].slice(-HISTORY);
    setHistory(h);
    setTick((t) => t + 1);
    setVitals((list) => [...list, { neurons: model.nodes.length, loop: Math.max(0, ...loops.map((s) => strength(s, h))) }].slice(-HISTORY));
    const life = live(model, fresh ? tiers : null, h, energy, world, locate, Math.random, timing);
    setEnergy(life.energy);
    setWorld(life.world);
    setFrames(list => [...list, { tick: tick + 1, neurons: Object.fromEntries(model.nodes.map((node, i) => [node.id, {
      node, readIds: node.inputs.map(j => model.nodes[j].id), on: timing[i].active && !!((h[h.length - 1] >>> i) & 1), energy: life.energy[node.id] ?? 0,
      heat: life.budgets[i].heat, budget: life.budgets[i],
    }])) }].slice(-HISTORY));
    if (life.events.length) setEvents((list) => [...life.events.map((e) => ({ ...e, tick: tick + 1,
      id: (e.kind === "born" ? life.model : model).nodes.find(n => n.label === e.label)!.id,
      parentId: model.nodes.find(n => n.label === e.parent)?.id,
    })), ...list].slice(0, LOGGED));
    if (life.model !== model) change(life.model);
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
      if (event.target instanceof HTMLElement && event.target.closest("input, select, button, [role=button]")) return;
      if (event.key === " ") setRunning((r) => !r);
      else if (event.key === "s") actions.current.advance();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateNode = (index: number, node: BinaryNode) =>
    change({ ...model, nodes: model.nodes.map((n, i) => (i === index ? node : n)) });

  const generateRandom = () => {
    const next = randomModel(6, Math.floor(Math.random() * 0xffffffff) || 1);
    bodies.current.clear();
    setEnergy(Object.fromEntries(next.nodes.map((n) => [n.id, START_ENERGY])));
    setModel(next);
    setHistory([randomState(next)]);
    setSelectedId(next.nodes[0]?.id ?? null);
    setTick(0);
    setEvents([]);
    setFrames([]);
    setVitals([]);
    setWorld(startWorld);
  };

  const { focus } = useLeadingGroup(model, tiers, fresh, running);
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
    <div className="app-shell">
      <header className="app-header">
        <span className="brand" aria-label="Logocausal">
          <span className="brand-mark" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="26" height="26" />
          </span>
        </span>
        <div className="transport" role="toolbar" aria-label="Simulation">
          <button className="primary-button" onClick={() => setRunning(!running)}>
            {running ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button onClick={advance} disabled={running}>Step</button>
          <button onClick={generateRandom}>Random gen</button>
          <button
            onClick={() => {
              const freshModel = emptyModel();
              bodies.current.clear();
              setModel(freshModel);
              setHistory([0]);
              setTick(0);
              setEnergy({});
              setEvents([]);
              setVitals([]);
              setFrames([]);
              setWorld(startWorld);
              setSelectedId(null);
            }}
          >
            ↻ Reset
          </button>
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
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <div className="stage">
          <section className="panel graph-panel" aria-label="Network">
            <div className="habitat-heading"><h1>Network</h1><div className="hud" aria-live="off">
              T{String(tick).padStart(4, "0")} · {model.nodes.filter((_, i) => (state >>> i) & 1).length}/{model.nodes.length} ON
              {running ? "" : " · PAUSED"}
            </div></div>
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
            {!model.nodes.length && <div className="habitat-empty"><h2>No neurons.</h2><p>Generate a population to run the simulation.</p><button className="primary-button" onClick={generateRandom}>Random gen</button></div>}
            </div>
          </section>

          <SidePanel active={panel} onChange={setPanel} population={
            <section className="panel groups-panel" aria-label="Population">
              <div className="panel-heading"><h2>Population</h2></div>
              <div className="group-content">
              <Vitals vitals={vitals} />
              <div className="history-heading"><h3>{running ? "Leading group" : "Highest-bit group"}</h3><span role="status" aria-label="Finding">{finding}</span></div>
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
              <p className="hint leader-note" title="A challenger needs a 2-second lead of at least 0.05 bit or 10%. Near ties keep the displayed group. Pausing shows the exact highest score.">{running ? "Stable view · pause for exact ranking" : "Exact ranking · paused"}</p>
              {focus && <GroupMachine model={model} mask={focus.mask} running={running} history={history} frames={frames} />}
              <div className="history-heading population-history"><h3>Population history</h3></div>
              {events.length ? <ol className="log" aria-label="Life log">{events.map((e, k) => <li key={k} className={e.kind}><span>T{e.tick}</span> {e.kind === "born" ? `${e.parent} → ${e.label}` : `${e.label} ${e.cause}`}</li>)}</ol> : <p className="hint">No births or deaths yet.</p>}
              </div>
            </section>
          } neuron={
            <NeuronInspector model={model} selectedId={selectedId} onSelect={setSelectedId}
              history={history} energy={energy} world={world} bodies={bodies.current} frames={frames} events={events}
              onChange={updateNode} onRemove={(index) => change(removeNode(model, index))} />
          } guide={<SimulationGuide />} />
        </div>
      </main>
    </div>
  );
}
