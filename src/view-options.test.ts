import { describe, expect, it } from "vitest";
import { viewOptions } from "./view-options";

describe("public embed options", () => {
  it("ignores unknown and invalid values and preserves the first repeated value", () => {
    const options = viewOptions(new URLSearchParams("theme=invalid&theme=light&speed=oops&speed=12&unknown=true"));
    expect(options).toMatchObject({ theme: "dark", speed: 3, autoplay: true, embed: false, transparent: false, autofocus: false });
  });

  it("keeps the hosted embed in field mode even when the query requests otherwise", () => {
    expect(viewOptions(new URLSearchParams("embed=false&autoplay=false&transparent&autofocus=true"), true))
      .toMatchObject({ embed: true, autoplay: false, transparent: true, autofocus: true });
    expect(viewOptions(new URLSearchParams("embed&transparent=false&autofocus=false")))
      .toMatchObject({ embed: true, transparent: false, autofocus: false });
  });

  it.each([["100", 12], ["0", 1], ["2.7", 3], ["", 3], ["Infinity", 3]])
    ("normalizes speed %s to %s", (value, speed) => {
      expect(viewOptions(new URLSearchParams({ speed: value })).speed).toBe(speed);
    });
});
