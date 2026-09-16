/**
 * Turns a stream of per-camera classifier scores into a decision about whether
 * to fire a trigger.
 *
 * Three problems have to be solved together, and none of them is optional:
 *
 * 1. **Noise.** The classifier runs several times a second. A single frame that
 *    crosses a threshold is not an event, it is a flicker. Scores are smoothed
 *    before anything looks at them.
 *
 * 2. **Duration.** "Someone walked up behind me" and "I've left my desk for a
 *    while" are the same kind of condition at wildly different timescales. The
 *    condition must hold for a configured dwell before it counts.
 *
 * 3. **Several cameras disagreeing.** This is the interesting one, see
 *    `CombineRule` below.
 */

/**
 * How several cameras' verdicts combine.
 *
 * The right answer depends on what the cameras are *for*, which only the person
 * who set them up knows:
 *
 * - `any`, fires when at least one camera is sure. Correct when the cameras
 *   watch different places (hallway, kitchen, front door), and correct for
 *   "something is present" conditions generally: a camera that can't see the
 *   dog is not evidence there is no dog.
 *
 * - `all`, every camera that has an opinion must agree. Correct for "nothing
 *   is there" conditions, "I've left my desk", "the couch is clear", where a
 *   single camera still seeing you is conclusive proof the condition is false.
 *
 * Getting this backwards is not subtle. With `any` on an absence condition,
 * three cameras watching one desk will fire "you left" the moment any one of
 * them has an empty frame, while you are sitting in front of another.
 */
export type CombineRule = "any" | "all";

export interface TriggerRule {
  /** Which trained class this watches. */
  classId: string;
  /** A camera at or above this is treated as seeing it. */
  threshold: number;
  /** A camera at or below this is treated as not seeing it. Between the two it abstains. */
  releaseThreshold: number;
  /** How long the combined condition must hold before firing. */
  dwellSeconds: number;
  /** Minimum gap between fires, so one condition doesn't fire once per frame. */
  cooldownSeconds: number;
  combine: CombineRule;
}

export const DEFAULT_RULE: Omit<TriggerRule, "classId"> = {
  threshold: 0.7,
  releaseThreshold: 0.5,
  dwellSeconds: 2,
  cooldownSeconds: 60,
  combine: "any",
};

/** Smoothing constant: how much weight a new frame carries. Roughly a 1s window at 8Hz. */
const SMOOTHING = 0.25;

/** One camera's latest score for the watched class, before smoothing. */
export interface CameraReading {
  cameraId: string;
  score: number;
}

type Vote = "yes" | "no" | "abstain";

export interface EngineState {
  /** True when the combined condition currently holds. */
  condition: boolean;
  /** How long it has held, in ms. Paused rather than reset while every camera abstains. */
  heldMs: number;
  /** True on the tick where the trigger fires. */
  fired: boolean;
  /** Cameras currently voting yes, useful for showing which one saw it. */
  seeing: string[];
  /** True while cooling down after a fire. */
  cooling: boolean;
  /** No camera has an opinion right now. */
  unknown: boolean;
}

export class TriggerEngine {
  private smoothed = new Map<string, number>();
  private condition = false;
  private heldMs = 0;
  private lastTick: number | null = null;
  private lastFiredAt: number | null = null;

  constructor(private rule: TriggerRule) {}

  setRule(rule: TriggerRule) {
    this.rule = rule;
  }

  reset() {
    this.smoothed.clear();
    this.condition = false;
    this.heldMs = 0;
    this.lastTick = null;
    this.lastFiredAt = null;
  }

  private vote(score: number): Vote {
    if (score >= this.rule.threshold) return "yes";
    if (score <= this.rule.releaseThreshold) return "no";
    // The band between the two thresholds is the honest answer to "a camera
    // that can only see half the person". It is not weak evidence either way
    // it is no evidence, and it must not drag the decision around.
    return "abstain";
  }

  update(readings: CameraReading[], now: number): EngineState {
    const elapsed = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;

    const votes: Vote[] = [];
    const seeing: string[] = [];

    for (const reading of readings) {
      const previous = this.smoothed.get(reading.cameraId);
      const value =
        previous === undefined ? reading.score : previous + SMOOTHING * (reading.score - previous);
      this.smoothed.set(reading.cameraId, value);

      const vote = this.vote(value);
      votes.push(vote);
      if (vote === "yes") seeing.push(reading.cameraId);
    }

    // Cameras that have gone away shouldn't keep voting from memory.
    const live = new Set(readings.map((r) => r.cameraId));
    for (const id of [...this.smoothed.keys()]) if (!live.has(id)) this.smoothed.delete(id);

    const yes = votes.filter((v) => v === "yes").length;
    const no = votes.filter((v) => v === "no").length;
    const unknown = votes.length === 0 || (yes === 0 && no === 0);

    let condition = this.condition;
    if (!unknown) {
      condition =
        this.rule.combine === "any"
          ? yes > 0
          : // "all": everyone with an opinion agrees, and at least one has one.
            yes > 0 && no === 0;
    }
    // When every camera abstains the condition is genuinely unknown, so the
    // last known state is held and the dwell clock pauses rather than resets.
    // A moment of occlusion shouldn't restart a five-minute countdown.

    if (condition) {
      this.heldMs = this.condition ? this.heldMs + (unknown ? 0 : elapsed) : 0;
    } else {
      this.heldMs = 0;
    }
    this.condition = condition;

    const cooling =
      this.lastFiredAt !== null && now - this.lastFiredAt < this.rule.cooldownSeconds * 1000;

    let fired = false;
    if (condition && this.heldMs >= this.rule.dwellSeconds * 1000 && !cooling) {
      fired = true;
      this.lastFiredAt = now;
    }

    return { condition, heldMs: this.heldMs, fired, seeing, cooling: cooling && !fired, unknown };
  }
}
