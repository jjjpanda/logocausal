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
