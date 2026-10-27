import { describeActivity } from "../core/machine";
import { groupHistory } from "../core/history";
import type { Frame } from "../core/history";
import { members } from "../core/model";
import type { NetworkModel } from "../core/model";

export default function GroupActivity({ model, mask, frames }: { model: NetworkModel; mask: number; frames: Frame[] }) {
  const group = members(mask, model.nodes.length);
  const { timeline, patterns } = groupHistory(model, mask, frames);
  const recent = timeline.slice(-24);
  return <>
    <div className="machine-observation"><b>Live</b><span>{describeActivity(patterns)}</span></div>
    <div className="machine-raster" role="img" aria-label={`Group activity over the last ${recent.length} ticks; newest at right`}>
      {group.map((i, row) => <div className="raster-row" key={model.nodes[i].id}>
        <span>{model.nodes[i].label}</span><div>{Array.from({ length: 24 }, (_, k) => {
          const sample = recent[k - (24 - recent.length)];
          const signal = sample?.signals[row];
          return <i key={k} className={`${signal === undefined ? "empty" : signal ? "on" : ""}${sample?.changed ? " rule-change" : ""}`}
            title={sample ? `T${sample.tick} · ${signal === undefined ? "not recorded" : signal ? "on" : "off"}${sample.changed ? " · circuit changed" : ""}` : "Not recorded"} />;
        })}</div>
      </div>)}
    </div>
    {!!recent.length && <p className="machine-note">T{recent[0].tick}–T{recent.at(-1)!.tick} · signals retained across rule changes. Marks show circuit changes; rhythm uses only the current rules.</p>}
  </>;
}
