import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_NODES, addNode, emptyModel, randomModel, remapState, removeNode, validateModel } from "./core/model";
import type { BinaryNode, NetworkModel } from "./core/model";
import type { TierScore } from "./core/recursion";
import { HISTORY, LIGHT_RANGE, START_ENERGY, W, live, liveLoop, step } from "./core/evolve";
import type { Energy, LifeEvent, World } from "./core/evolve";
import { influences as influenceMatrix } from "./core/info";
import NetworkGraph, { GROUP_COLORS, groupName } from "./components/NetworkGraph";
import type { Bodies } from "./components/NetworkGraph";
import RuleEditor from "./components/RuleEditor";
import Vitals from "./components/Vitals";
import type { Vital } from "./components/Vitals";
import { HALF_COLORS, TIER_LABEL, TIER_TERM } from "./tiers";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";
import { DRAFT_KEY, parseDraft, serializeDraft } from "./draft";

const initial = emptyModel();
const bits = (value: number) => value.toFixed(2);
const LISTED = 40;
const LOGGED = 6;
const NOISE = 0.002;
const START_WORLD: World = {
  lit: true,
  sun: W / 2,
  food: [
    { x: W / 2 + 120, y: 240, amount: 1 },
    { x: W / 2 - 130, y: 260, amount: 1 },
    { x: W / 2 + 10, y: 340, amount: 1 },
  ],
};

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { model: parseDraft(raw), restored: true, message: "Draft restored." };
  } catch {
    return { model: initial, restored: false, message: "Saved draft could not be read." };
  }
  return { model: initial, restored: false, message: "" };
}

const randomState = (model: NetworkModel) => Math.floor(Math.random() * 2 ** model.nodes.length);

export default function App() {
  const [startup] = useState(restoreDraft);
  const [model, setModel] = useState<NetworkModel>(startup.model);
  const [history, setHistory] = useState(() => [randomState(startup.model)]);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);
  const [dark, setDark] = useState(false);
  const [world, setWorld] = useState(START_WORLD);
  const [events, setEvents] = useState<(LifeEvent & { tick: number })[]>([]);
  const [energy, setEnergy] = useState<Energy>({});
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [speed, setSpeed] = useState(3);
  const [analysis, setAnalysis] = useState<{ model: NetworkModel; tiers: TierScore[] } | null>(null);
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState(startup.message);
  const bodies = useRef<Bodies>(new Map());
  const influences = useMemo(() => influenceMatrix(model), [model]);
  const tiers = analysis?.tiers ?? null;
  const fresh = analysis?.model === model;
  const state = history[history.length - 1];

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, serializeDraft(model));
    } catch {
      setDraftStatus("Draft storage unavailable.");
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
        setSelectedGroup((mask) =>
          found.some((s) => s.mask === mask && s.tier !== "perception") ? mask : (found[0]?.mask ?? 0),
        );
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
    setSelectedGroup(remap);
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
    const locate = (id: string) => bodies.current.get(id) ?? { x: W / 2, y: LIGHT_RANGE * 0.45 };
    const h = [...history, step(model, history, world, locate, NOISE)].slice(-HISTORY);
    setHistory(h);
    setTick((t) => t + 1);
    setVitals((list) => [...list, { neurons: model.nodes.length, loop: Math.max(0, ...loops.map((s) => strength(s, h))) }].slice(-HISTORY));
    const life = live(model, fresh ? tiers : null, h, energy, world, locate);
    setEnergy(life.energy);
    setWorld(life.world);
    if (life.events.length) setEvents((list) => [...life.events.map((e) => ({ ...e, tick })), ...list].slice(0, LOGGED));
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
    setSelectedId(null);
  };

  const aware = tiers?.filter((s) => s.tier !== "perception") ?? [];
  const focus = tiers?.find((s) => s.mask === selectedGroup);
  const finding = !tiers ? "Analysing…" : loops.length ? `${loops.length} loop${loops.length > 1 ? "s" : ""}` : "No loops";
  const rows =
    focus?.tier === "consciousness"
      ? [
          { mask: focus.model, color: HALF_COLORS[0] },
          { mask: focus.record, color: HALF_COLORS[1] },
        ]
      : focus
        ? [{ mask: focus.mask, color: "#ffd93d" }]
        : [];
  const outlines = [
    ...rows.map((row) => ({ ...row, bold: true })),
    ...loops
      .filter((s) => s.mask !== focus?.mask)
      .slice(0, 2)
      .map((s, i) => ({ mask: s.mask, color: GROUP_COLORS[i], bold: false })),
  ];
  const neuron = selectedId === null ? -1 : model.nodes.findIndex((node) => node.id === selectedId);
  const half = (mask: number, k: number) => <b style={{ color: HALF_COLORS[k] }}>{groupName(model, mask)}</b>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">
          <span className={`brand-mark ${running ? "live" : ""}`} aria-hidden="true">◉</span>
          Logocausal
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
              setWorld(START_WORLD);
              setSelectedId(null);
            }}
          >
            ↻ Reset
          </button>
          <label className="toggle">
            <input type="checkbox" checked={world.lit} onChange={(e) => setWorld({ ...world, lit: e.target.checked })} />
            Sun
          </label>
          <label className="toggle">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            Dark
          </label>
          <label className="slider">
            speed <b>{speed}/s</b>
            <input type="range" min={1} max={12} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
        </div>
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
            <div className="hud" aria-live="off">
              T{String(tick).padStart(4, "0")} · {model.nodes.filter((_, i) => (state >>> i) & 1).length}/{model.nodes.length} ON
              {running ? "" : " · PAUSED"}
            </div>
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
              outlines={outlines}
              focus={focus}
              selectedNeuron={neuron < 0 ? null : neuron}
              onNeuron={(i) => setSelectedId(neuron === i ? null : model.nodes[i].id)}
            />
            <Vitals vitals={vitals} />
          </section>

          <aside className="side">
            <section className="panel" aria-label="Groups">
              <h2>
                Groups{" "}
                <span className="finding" role="status" aria-label="Finding">
                  {finding}
                </span>
              </h2>
              <div className="focus" aria-label="Selected group">
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
              <div className="ranking-list">
                {(loops.length ? loops : aware).slice(0, LISTED).map((s) => (
                  <button
                    key={s.mask}
                    className={`ranking-row ${selectedGroup === s.mask ? "selected" : ""}`}
                    aria-pressed={selectedGroup === s.mask}
                    aria-label={`Inspect group ${groupName(model, s.mask)}`}
                    onClick={() => setSelectedGroup(s.mask)}
                  >
                    <strong>{groupName(model, s.mask)}</strong>
                    <span className={`tier tier-${s.tier}`} title={TIER_TERM[s.tier]}>
                      {TIER_LABEL[s.tier]}
                    </span>
                    <span className="score">{bits(s.tier === "consciousness" ? s.loop : s.awareness)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel" aria-label="Rule">
              <h2>{neuron < 0 ? "Network · Rule" : `Network · Neuron ${model.nodes[neuron].label}`}</h2>
              <div className="neuron-bar">
                {model.nodes.map((node, i) => (
                  <button
                    key={node.id}
                    className={`neuron-pill ${neuron === i ? "selected" : ""}`}
                    onClick={() => setSelectedId(neuron === i ? null : node.id)}
                  >
                    {node.label}
                  </button>
                ))}
                <button
                  disabled={model.nodes.length >= MAX_NODES}
                  onClick={() => {
                    const next = addNode(model);
                    const created = next.nodes[next.nodes.length - 1];
                    setEnergy((prev) => ({ ...prev, [created.id]: START_ENERGY }));
                    change(next);
                    setSelectedId(created.id);
                  }}
                >
                  + Add neuron
                </button>
                <button onClick={generateRandom}>Random gen</button>
              </div>
              {neuron >= 0 ? (
                <RuleEditor
                  key={model.nodes[neuron].id}
                  model={model}
                  index={neuron}
                  onChange={(next) => updateNode(neuron, next)}
                  onRemove={() => {
                    const next = removeNode(model, neuron);
                    change(next);
                    setSelectedId(next.nodes[Math.min(neuron, next.nodes.length - 1)]?.id ?? null);
                  }}
                />
              ) : (
                <p className="hint">Select a neuron above or in the space to edit its sense, move, or logical connections.</p>
              )}
              {events.length > 0 && (
                <ol className="log" aria-label="Life log">
                  {events.map((e, k) => (
                    <li key={`${e.tick}-${k}-${e.label}`} className={e.kind}>
                      <span>t{e.tick}</span> {e.kind === "born" ? `${e.parent} → ${e.label}` : `${e.label} ${e.cause}`}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        </div>
      </main>
      {draftStatus && (
        <footer role="status" aria-label="Draft status">
          {draftStatus}
        </footer>
      )}
    </div>
  );
}
