export interface ViewOptions {
  embed: boolean;
  theme: "dark" | "light";
  speed: number;
  autoplay: boolean;
  transparent: boolean;
  autofocus: boolean;
}

const enabled = (value: string | null) => value === "" || value === "true";

/** URLSearchParams uses the first repeated value; invalid options fall back to defaults. */
export function viewOptions(params: Pick<URLSearchParams, "get">, embed = false): ViewOptions {
  const rawSpeed = params.get("speed");
  const speed = rawSpeed?.trim() ? Number(rawSpeed) : NaN;
  return {
    embed: embed || enabled(params.get("embed")),
    theme: params.get("theme") === "light" ? "light" : "dark",
    speed: Number.isFinite(speed) ? Math.max(1, Math.min(12, Math.round(speed))) : 3,
    autoplay: params.get("autoplay") !== "false",
    transparent: enabled(params.get("transparent")),
    autofocus: enabled(params.get("autofocus")),
  };
}
