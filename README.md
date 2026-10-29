# Logocausal

A live simulation of small Boolean networks. Neurons are Boolean logic units that fire, tire, eat, warm up, grow dendrites, clone and die. Links pull related neurons together.

- **Run.** Start empty and use Random gen to seed six neurons. The network ticks on its own. At 6 ticks/second and above, gold briefly marks signal starts, twelve small bars in each body retain the last twelve on/off signals (newest at right), and signal trails travel over 650 ms so paths remain readable. These are visual histories, not delayed simulation signals. Birth/death rings remain visible. Pause or slow down to see individual on/off states. Reduced-motion mode retains the history bars and suppresses moving trails. Keys: `space` play/pause, `s` step.
- **Read.** One side panel has Population, Neuron and Guide tabs on every screen size. Population holds the neuron-count and best-loop time charts, the leading group, machine description and recent births and deaths. A feedback loop's two halves appear in blue and red in the network. While running, a challenger must stay ahead for two seconds by at least 0.05 bit or 10% of the incumbent score, whichever is larger. Near ties keep the current group; unavailable groups are replaced immediately. Pausing shows the exact highest-bit group. Membership follows neuron IDs through births and deaths.
- **Describe.** Machine type describes gate behavior: relay, inverter, combiner, coincidence/parity circuit, memory, oscillator or settling feedback. Changes settle for 1.5 seconds while a notice identifies the previous settled description; pausing or selecting a different group updates immediately. A separate Live line and 24-tick raster show observed rhythm or changing patterns. Observations restart when that group's rules change, while unrelated edits preserve them.
- **Inspect.** Click a neuron or use the inspector selector to read its energy, temperature, activity and energy history, connections, and life events. Edit its rule in Rule & connections. Recently deceased neurons remain available in the selector while their history is retained.
- **Shape.** Drag neurons. Sunlight is always on and circles the edge slowly. Round neurons show a large name, a role caption, and a thin energy arc; a small arrow marks movement. Gold means activity, arc color shows temperature, and a heavier cell border marks selection. Hover or inspect for detailed status. Names stay readable on small canvases. The workspace fits the viewport; panels scroll internally. Guide contains the visual legend and explanations of life rules, groups and charts. The canvas has no footer. Dark mode is the default; the header's moon/sun checkbox switches themes.

## Life rules

Each tick combines these rules:

1. **Move locally.** Twenty physics substeps move the bodies using their current signals. Active food movers seek food they can smell themselves. Light movers seek a comfortable band 504 px from the sun. A motor pushes its own body; springs transmit motion to linked neighbours. Bodies repel, and there is no attraction to a global population centre. Separate groups can pursue different resources.
2. **Fire.** Each neuron computes its rule from the neurons it reads (NOT, AND, OR, XOR, …) when its local clock advances. A sensor ORs in the world at its spot: light sensors fire when light ≥ 0.5, food sensors fire when food is within smell range. Noise flips a bit with probability 0.002 on an update. Cold neurons retain their signal between updates. A neuron with no inputs and no sensed stimulus stays quiet, apart from noise.
3. **Fatigue and temperature.** Three consecutive local firings force one local update off. Temperature is local light (1 at the sun, 0 at 1,200 px) plus 0.06 per actual fire in the last four ticks. Below 0.25, processes slow proportionally, down to 10% speed; held signals add no fatigue or firing heat. Above 0.85, heat costs 0.02 energy/tick. The sun moves 3 px/tick along the habitat perimeter.
4. **Eat and cooperate.** In a food zone, on neurons request 0.075 energy/tick and quiet ones graze at 0.015, scaled by temperature. Competing appetites share the available stock proportionally and simultaneously. Base upkeep is 0.012, increased by links, roles and crowding **within 240 px**, so a distant colony adds no crowding cost. Firing costs 0.008. Live feedback earns 0.012 energy/bit/tick, capped at 60% of upkeep: a loop helps but cannot support life without food. Linked neurons share energy from richer to poorer, regardless of read direction. Sharing falls with distance and conserves energy; donors send at most 10% of their balance, further reduced in cold conditions.
5. **Store, die or divide.** New populations start with 1.4 energy per neuron. Reserves cap at 3.3; discarded surplus appears in the energy budget. At zero energy a neuron dies. On a local update, the richest neuron at 2.2 energy divides, sharing its energy equally with its child. At most one birth happens per tick, and births stop at 14 neurons. A child inherits its parent's rule and roles, with a 25% chance to attempt one mutation. One existing reader of the parent, if present, switches to the child without changing its gate or input count. This preserves working rules through reproduction.
6. **Adapt.** New dendrites reach only partners within 520 px; nearer and reciprocal partners are favoured. Growth starts at 0.6%/tick. Neurons spending less than 15% or more than 65% of recent history on explore more: growth rises to 1.8% and gate changes rise from 0.2% to 2.2%. With more than one input, a neuron may prune its weakest input: variable signals that affect its gate and come from nearby survive longer. Sensor and mover roles each have a 0.2% chance/tick to be reconsidered, including changing or disappearing. All these chances slow in the cold. Each neuron still reads at most three others.
7. **Renew food.** Three separated patches start with 4 stock each. A patch grows by `0.32 × light × (1 − stock/8)` per tick: it recovers after grazing and approaches a maximum of 8. In complete darkness it loses 0.025/tick. Spawning is attempted with a 30% chance/tick (always when empty); a new patch starts at 4 stock. At most eight patches fit, with at least 496 px between centres. Feeding radii cap at 224 px, and smell extends further. A zone fades as its stock falls. Resizing thins patches if the smaller habitat cannot preserve their spacing.

Physics is independent of frame rate or selected speed. Links have stable, varied spring lengths. The habitat follows the canvas aspect ratio; resizing scales neuron and food positions. Extinction remains possible, and there is no automatic reseeding. See [the ecology investigation](docs/ecology.md) for exact plasticity formulas, measured before/after results and limitations.

## Tiers

All neurons start random and independent; a sensor is an outside random bit. Numbers are exact mutual information in bits, one tick ahead.

| Tier | Test |
| --- | --- |
| Forgetful (Perception) | Any group. |
| Self-predicting (Awareness) | `I(S_t ; S_t+1) > 0`: the group's state fixes its own next state. |
| Feedback loop (Consciousness) | Some split of the group into two parts predicts each other both ways: `max over splits of min(I(M_t ; R_t+1), I(R_t ; M_t+1)) > 0`. |

Only groups linked by read-edges are scored, up to a fixed size. A group that holds a smaller loop is skipped, so every listed loop is minimal. Limits live in `src/core/model.ts` and `src/core/recursion.ts`.

Machine descriptions examine the group's gates separately from fatigue, temperature and noise. For feedback groups of at most five neurons and eight outside bits, all starting patterns and held-input combinations are enumerated: multiple fixed patterns indicate memory, longer cycles indicate oscillation, and a circuit may support both. Larger input boundaries receive a structural description. Live rhythm detection needs at least twelve observations and three repeats; it describes recent signals rather than promising future behavior or inferring a purpose from the bit score.

## Run

Node.js 22.12+ and npm.

```sh
npm install
npm run dev      # app
npm run verify   # types, unit tests, build
npm run test:e2e # browser tests (needs Chromium)
npm run test:ecology # 20 seeded 3,000-tick runs with activity/turnover metrics (can take minutes)
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` points the browser tests at an installed Chromium or Edge. The app runs fully in the browser. A draft of the network is saved in local storage.

## Layout

```text
src/core/    pure TypeScript: model, gates, information measures, tiers, life
src/components/  network graph, neuron inspector, vitals, rule editor
src/App.tsx  the single-screen simulation
src/analysis.worker.ts  runs the analysis off the main thread
e2e/         browser tests
```
