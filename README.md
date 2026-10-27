# Logocausal

A live simulation of small Boolean networks. Neurons are Boolean logic units that fire, tire, eat, warm up, grow dendrites, clone and die. Links pull related neurons together.

- **Run.** The network ticks on its own. Keys: `space` play, `s` step, `r` shake.
- **Read.** Select a group to see its loop: the two halves in blue and red, the links between them in their colors.
- **Shape.** Pick an example or roll one. Click a neuron to edit its rule. Drag neurons and food (green diamonds). The light (orange disc) circles the edge slowly.

## Life rules

Every tick, in order:

1. **Fire.** Each neuron computes its rule from the neurons it reads (NOT, AND, OR, XOR, …). A sensor (square) instead reads the world at its spot: ☀ fires when light ≥ 0.5, ◆ fires when food is within smell range. Noise flips random bits.
2. **Fatigue.** A neuron that fired 3 ticks in a row rests (forced off) for one tick. Dashed body = resting.
3. **Temperature** = light at the spot (1 at the disc, 0 at 560 px) + 0.06 per fire in the last 4 ticks. Safe band 0.25–0.85: the blue ring is the cold edge, the red ring the hot edge. In the dark, firing alone cannot stay warm.
4. **Energy.** A neuron gains food (0.05) if it fires within smell of food, and a bonus for the live strength of its best loop. It pays upkeep per link (more when crowded), a cost per fire, and damage outside the safe band. The ring around a neuron shows energy; its color shows cold (blue), hot (red) or fine (black).
5. **Death and birth.** At 0 energy a neuron dies (starved, froze or overheated); at least 3 stay. The richest logic neuron above 2.4 clones itself (sensors never clone) with one rule change into its family (B → B2). Eaten food grows back near the middle.
6. **Dendrites.** Each neuron (not sensors) has a 1% chance per tick to read one more random neuron (up to 3), joined by AND, OR or XOR, and a 0.4% chance to drop one. Useless links cost upkeep; useful ones form loops that pay.

## Tiers

All neurons start random and independent; a sensor is an outside random bit. Numbers are exact mutual information in bits, one tick ahead.

| Tier | Test |
| --- | --- |
| Forgetful (Perception) | Any group. |
| Self-predicting (Awareness) | `I(S_t ; S_t+1) > 0`: the group's state fixes its own next state. |
| Feedback loop (Consciousness) | Some split of the group into two parts predicts each other both ways: `max over splits of min(I(M_t ; R_t+1), I(R_t ; M_t+1)) > 0`. |

Only groups linked by read-edges are scored, up to a fixed size. A group that holds a smaller loop is skipped, so every listed loop is minimal. Limits live in `src/core/model.ts` and `src/core/recursion.ts`.

## Run

Node.js 22.12+ and npm.

```sh
npm install
npm run dev      # app
npm run verify   # types, unit tests, build
npm run test:e2e # browser tests (needs Chromium)
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` points the browser tests at an installed Chromium or Edge. The app runs fully in the browser. A draft of the network is saved in local storage.

## Layout

```text
src/core/    pure TypeScript: model, gates, information measures, tiers, life
src/components/  network graph, spacetime strip, rule editor
src/App.tsx  the single-screen simulation
src/analysis.worker.ts  runs the analysis off the main thread
e2e/         browser tests
```
