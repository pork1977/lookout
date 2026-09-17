import { DEFAULT_RULE, type TriggerRule } from "./triggerEngine";
import type { ClientActionId, SpeechOptions } from "./triggerActions";

/**
 * Everything about "what happens when it sees it" that is safe to keep with a
 * detector and to share. Webhook URLs and email addresses are deliberately not
 * in here: they are secrets of a sort, so they stay in the Triggers step's own
 * state and never get saved or shared.
 */
export interface TriggerSettings {
  rule: TriggerRule;
  template: string;
  clientActions: ClientActionId[];
  speech: SpeechOptions;
}

export const DEFAULT_TEMPLATE = "Lookout saw {what} ({confidence})";

const CLIENT_ACTION_IDS: ClientActionId[] = ["speak", "banner", "notify"];

export function defaultTriggerSettings(classId: string): TriggerSettings {
  return {
    rule: { ...DEFAULT_RULE, classId },
    template: DEFAULT_TEMPLATE,
    clientActions: ["banner"],
    speech: { rate: 1, pitch: 1 },
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/**
 * Settings arrive from IndexedDB or, for a shared link, from someone else's
 * account, so nothing is trusted: every field is re-checked and anything odd
 * falls back to the default. In particular only the three on-device actions
 * can come out of this, whatever the stored value claims.
 */
export function sanitizeTriggerSettings(raw: unknown, classIds: string[]): TriggerSettings {
  const fallback = defaultTriggerSettings(classIds[0] ?? "");
  if (!raw || typeof raw !== "object") return fallback;
  const input = raw as Partial<TriggerSettings>;
  const rule = (input.rule ?? {}) as Partial<TriggerRule>;
  const threshold = clamp(rule.threshold, 0.05, 1, DEFAULT_RULE.threshold);

  return {
    rule: {
      classId:
        typeof rule.classId === "string" && classIds.includes(rule.classId)
          ? rule.classId
          : fallback.rule.classId,
      threshold,
      releaseThreshold: Math.min(threshold, clamp(rule.releaseThreshold, 0, 1, DEFAULT_RULE.releaseThreshold)),
      dwellSeconds: clamp(rule.dwellSeconds, 0, 3600, DEFAULT_RULE.dwellSeconds),
      cooldownSeconds: clamp(rule.cooldownSeconds, 0, 86400, DEFAULT_RULE.cooldownSeconds),
      combine: rule.combine === "all" ? "all" : "any",
    },
    template:
      typeof input.template === "string" ? input.template.slice(0, 2000) : fallback.template,
    clientActions: Array.isArray(input.clientActions)
      ? CLIENT_ACTION_IDS.filter((id) => input.clientActions!.includes(id))
      : fallback.clientActions,
    speech: {
      rate: clamp(input.speech?.rate, 0.6, 1.4, 1),
      pitch: clamp(input.speech?.pitch, 0.6, 1.4, 1),
      voiceURI: typeof input.speech?.voiceURI === "string" ? input.speech.voiceURI : undefined,
    },
  };
}
