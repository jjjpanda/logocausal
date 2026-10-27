import type { Tier } from "./core/recursion";

export const TIER_LABEL: Record<Tier, string> = {
  perception: "Forgetful",
  awareness: "Self-predicting",
  consciousness: "Feedback loop",
};

/** The term for each tier. */
export const TIER_TERM: Record<Tier, string> = {
  perception: "Perception",
  awareness: "Awareness",
  consciousness: "Consciousness",
};

export const HALF_COLORS = ["#2f5bff", "#e5383b"];

/** A stable hue per neuron family, spread by the golden angle. */
export const familyColor = (family: string) =>
  `hsl(${([...family].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 137.508) % 360} 70% 42%)`;
