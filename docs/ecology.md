# Ecology and sustained behaviour

The simulation now couples local Boolean circuits to local movement, food competition, conservative energy sharing and reproduction. Nearby groups can pursue different resources. Quiet cells can survive long enough to acquire useful connections, but storage limits and seasonal food loss prevent unlimited reserves from insulating them from their environment.

The complete life rules are in [the README](../README.md#life-rules). The population begins with six random neurons when Random gen is pressed. No controller inserts a desired circuit, restores a minimum population or restarts an extinct population.

## What changed

- Motors move their own bodies. Springs transmit forces through connections; unrelated neurons are no longer driven by every motor or attracted to a global centre. Food motors use their own smell range.
- Crowding depends on neighbours within 240 px, including the neuron itself. A distant group no longer increases everyone's maintenance bill.
- Food grows at `0.32 * light * (1 - stock / 8)` rather than `1.2 * light`, and loses 0.025 stock/tick in complete darkness rather than 0.005. Grazing can deplete a patch, and resting patches recover. Quiet cells request 0.015 energy/tick; on cells request 0.075. These requests slow with temperature, and scarce stock is allocated proportionally without creating energy.
- Live feedback rewards remain 0.012 energy/bit/tick, but cannot exceed 60% of upkeep. Loops cannot generate enough energy to sustain an unfed population indefinitely.
- Initial energy rises from 1 to 1.4 and division requires 2.2 rather than 1.5. Larger newborn reserves give new circuits time to develop. A neuron stores at most 3.3 energy; excess is discarded after link sharing and is recorded in the inspector. Seasonal shortages can still matter after a long feast.
- A child normally inherits its parent's inputs, truth table and roles. With 25% probability it attempts one mutation. An existing reader of the parent, if any, switches one input to the child, preserving its truth table and number of operands. The old rule always mutated the child and widened another neuron's rule at every birth.
- Plasticity responds to recent activity and input usefulness rather than continually accumulating random links. Roles can be lost or changed as well as acquired.

These changes create opportunities for circuit preservation, local cooperation, separation, competition and adaptation. They do not establish open-ended evolution or intelligence.

## Exact plasticity rules

Let `a` be a neuron's fraction of on signals in the retained history, up to 96 ticks, and `r` its current temperature-dependent process rate. Until `history.length * r >= 16`, activity stress is zero. Afterwards:

```text
stress = max(0, (0.15 - a) / 0.15, (a - 0.65) / 0.35)
```

On each tick, a neuron with fewer than three inputs may add one with probability `0.006 * (1 + 2 * stress) * r`. Candidates must be within 520 px. Sampling weights are `1 / (1 + distance / 160)`, doubled if the candidate already reads this neuron. The new input joins the old rule by AND, OR or XOR; the first input uses COPY or NOT.

If no input was added and there are at least two existing inputs, each input gets a usefulness score:

```text
p = fraction of history in which the source is on
responsiveness = fraction of historical states where flipping that source changes the gate output
quality = 4 * p * (1 - p) * responsiveness / (1 + (distance / 520)^2)
```

The weakest input is removed with probability `0.004 * (1 + 4 * (1 - quality)) * r`. Removal fixes its value to zero in the remaining truth table. This score is a local heuristic for variable, influential signals, not an information-theoretic proof of causal benefit.

Independently, a neuron with inputs changes to a different supported gate with probability `(0.002 + 0.02 * stress) * r`. Its sensor role and motor role each have probability `0.002 * r` of being reconsidered, choosing light, food or none. Selecting the existing role makes no change. Growth, pruning, gate changes and role changes are stochastic; useful circuits are favoured, not frozen permanently.

All nodes adapt from the same pre-birth, pre-removal model and history. This avoids reading a newborn's nonexistent position or interpreting old history through shifted neuron indices. The model remains immutable when nothing changes.

## Execution and accounting

A tick performs 20 physics substeps with the previous signals, advances local Boolean clocks, computes the next signals and actual firing heat, allocates food, pays costs and loop rewards, diffuses energy through links, discards storage overflow, adapts the existing nodes, removes deaths, allows one division, and advances sunlight and food growth. Births split energy equally without creating it. The inspector's delta includes sharing and storage loss, before division.

At full process speed, upkeep is:

```text
0.012 * (1 + 0.35 * inputs + 0.15 * sensor + 0.15 * motor)
      * max(0.85, (local_population / 7)^2)
```

Firing costs 0.008; both costs scale with the local process rate. Temperatures above 0.85 cost another 0.02 per tick. Link sharing uses simultaneous pre-transfer balances, respects donor limits and conserves energy. No food or feedback bonus is awarded just for having a structural cycle: the feedback signal must vary in observed history.

## Measurement

These measurements predate the sun-radius increase from 900 to 1,200 px. They describe the ecology revision at 900 px, not a survival measurement of the current wider sun. The wider range affects temperature, local clocks and food growth as well as the visible zone.

The comparison uses seeds 1–20, six initial neurons, a 1600 × 1000 habitat, the same three initial food patches, noise 0.002, and 3,000 ticks or extinction. That covers about 1.73 sun circuits. It includes the same 20 physics substeps per tick as the app and recomputes exact topology analysis whenever the model changes. Placement, evolution and newborn IDs are deterministic; IDs affect spring lengths and must be seeded too.

| Measurement | Before | Revised |
| --- | ---: | ---: |
| Populations alive at tick 3,000 | 12 / 20 | **18 / 20** |
| Mean observed lifetime, capped at 3,000 | 2,636.6 ticks | **2,921.15 ticks** |
| Total births | 497 | **585** |
| Births in ticks 1,501–3,000 | 193 | **254** |
| Second-half time with live feedback | 67.9% | **80.8%** |
| Whole-run time with live feedback, after history warmup | 81.6% | 81.7% |
| Mean per-neuron activity entropy | 0.791 bits | 0.735 bits |
| Mean displacement per body per tick | 50.55 px | 17.04 px |

The measured improvement is in persistence, late feedback and continuing reproduction. Individual signal entropy fell slightly, and movement became slower as motors stopped pushing unrelated bodies. These results do not show an across-the-board increase in every measure of complexity. The mechanisms support more local interaction and adaptive circuits; no scalar metric here proves emergence.

With random signal flips disabled, all **10 / 10** revised populations (seeds 1–10) reached 3,000 ticks. They produced 356 births, including 134 in the second half, with live feedback during 88.4% of second-half ticks. Sustained activity therefore does not require the 0.002 signal-flip noise, although evolutionary mutations and plasticity remain stochastic.

The revised populations at tick 3,000 were `12, 14, 8, 10, 13, 4, 14, 10, 1, 14, 14, 0, 0, 14, 13, 1, 13, 9, 7, 14`. Seeds 12 and 13 went extinct at ticks 2,245 and 2,178. Seeds ending with one neuron demonstrate a remaining failure mode: survival alone need not preserve a rich circuit.

See [the raw results](ecology-results.json) for every seed, baseline core source identifiers and the zero-signal-noise control. The initial baseline capture had a one-window denominator error in whole-run fractions; the stored comparison corrects it to include the initial signal state, without changing any trajectories or event counts. These seeds were used during tuning, so this is an engineering regression comparison rather than independent statistical validation.

A live-loop tick has observed strength above 0.05 bits in at least one structurally scored minimal loop. Live-loop fractions count time after extinction as zero. Activity entropy is the average binary on/off entropy per living neuron over the last 96 signals, averaged over observed windows while alive. A four-step repeating pulse can have substantial entropy; this is a variation measure, not a complexity score. Distinct states include neuron identity and therefore also reflect births. Movement measures mean net displacement per body per tick; more movement is not inherently better.

The browser runs exact analysis in a worker and temporarily omits loop rewards while its result is stale. Its habitat also follows the canvas aspect ratio. Consequently browser trajectories can differ from these synchronous, fixed-habitat measurements. The finite runs do not guarantee indefinite survival or greater complexity for every seed. Drafts retain topology, not world state, energy or past activity.

## Reproduce

```powershell
npm run test:ecology

# Optional controls; defaults are 20 seeds, 3000 ticks and noise 0.002.
$env:ECOLOGY_SEEDS = '10'
$env:ECOLOGY_TICKS = '3000'
$env:ECOLOGY_NOISE = '0'
$env:ECOLOGY_OUTPUT = '.verification/ecology-no-noise.json'
npm run test:ecology
```

`ECOLOGY_OUTPUT` is optional and its parent directory must exist. Other supported settings are validated before the run. The diagnostic prints progress per seed, then a table and JSON summary. It can take several minutes because exact information analysis is repeated as circuits evolve. The zero-noise control removes random signal flips; evolutionary mutation and plasticity remain stochastic.
