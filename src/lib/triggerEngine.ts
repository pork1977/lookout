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
  /**
   * Turns repeat firing off in favour of once-per-visit. Unset (the default):
   * the rule above fires again every cooldown for as long as the condition
   * keeps holding, which is right for "someone walked up behind me" but wrong
   * for "I've come back to my desk", where sitting there for 20 minutes would
   * otherwise fire every cooldown the whole time.
   *
   * Set to another class's id, and firing needs that class to have been seen
   * since the last fire: it "arms" the watched class, and firing "disarms" it
   * again. So "at my desk", armed by "away", fires once on arrival and stays
   * quiet through anything else (leaning back, a call, whatever) until it
   * sees "away" again.
   */
  requireAfterClassId?: string;
  /**
   * Only meaningful with requireAfterClassId set. Whether the rule starts
   * already armed (can fire the first time the watched class is seen, with
   * no prior sighting of the arming class in this session) or disarmed
   * (must see the arming class at least once before it can fire at all).
   * Defaults to disarmed: a fresh start shouldn't count as an arrival.
   */
  startArmed: boolean;
}

export const DEFAULT_RULE: Omit<TriggerRule, "classId"> = {
  threshold: 0.7,
  releaseThreshold: 0.5,
  dwellSeconds: 2,
  cooldownSeconds: 60,
  combine: "any",
  startArmed: false,
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
  /** Each live camera's smoothed score, which is what the votes were taken on. */
  scores: Record<string, number>;
  /**
   * Only meaningful when the rule has a requireAfterClassId. True once the
   * arming class has been seen and the watched class is free to fire; false
   * while it's waiting to see the arming class again.
   */
  armed: boolean;
}

export class TriggerEngine {
  private smoothed = new Map<string, number>();
  private gateSmoothed = new Map<string, number>();
  private condition = false;
  private heldMs = 0;
  private lastTick: number | null = null;
  private lastFiredAt: number | null = null;
  private armed: boolean;

  constructor(private rule: TriggerRule) {
    this.armed = !rule.requireAfterClassId || rule.startArmed;
  }

  setRule(rule: TriggerRule) {
    // Only reset the arming state when the gate itself changes shape (added,
    // removed, or pointed at a different class). Tuning the dwell or cooldown
    // mid-watch shouldn't throw away an arm that's already been earned, the
    // same reasoning that already applies to the dwell clock below.
    if (rule.requireAfterClassId !== this.rule.requireAfterClassId) {
      this.armed = !rule.requireAfterClassId || rule.startArmed;
    }
    this.rule = rule;
  }

  reset() {
    this.smoothed.clear();
    this.gateSmoothed.clear();
    this.condition = false;
    this.heldMs = 0;
    this.lastTick = null;
    this.lastFiredAt = null;
    this.armed = !this.rule.requireAfterClassId || this.rule.startArmed;
  }

  private vote(score: number): Vote {
    if (score >= this.rule.threshold) return "yes";
    if (score <= this.rule.releaseThreshold) return "no";
    // The band between the two thresholds is the honest answer to "a camera
    // that can only see half the person". It is not weak evidence either way
    // it is no evidence, and it must not drag the decision around.
    return "abstain";
  }

  /**
   * `gateReadings` is only read when the rule has a requireAfterClassId: one
   * reading per camera for that other class, taken from the same frame as
   * `readings`. Passing it when there's no gate, or omitting it when there
   * is, is harmless either way; the gate just can't arm without it.
   */
  update(readings: CameraReading[], now: number, gateReadings?: CameraReading[]): EngineState {
    const elapsed = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;

    const votes: Vote[] = [];
    const seeing: string[] = [];
    const scores: Record<string, number> = {};

    for (const reading of readings) {
      const previous = this.smoothed.get(reading.cameraId);
      const value =
        previous === undefined ? reading.score : previous + SMOOTHING * (reading.score - previous);
      this.smoothed.set(reading.cameraId, value);
      scores[reading.cameraId] = value;

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

    if (this.rule.requireAfterClassId && gateReadings?.length) {
      const gateVotes = gateReadings.map((reading) => {
        const previous = this.gateSmoothed.get(reading.cameraId);
        const value =
          previous === undefined ? reading.score : previous + SMOOTHING * (reading.score - previous);
        this.gateSmoothed.set(reading.cameraId, value);
        return this.vote(value);
      });
      const gateLive = new Set(gateReadings.map((r) => r.cameraId));
      for (const id of [...this.gateSmoothed.keys()]) if (!gateLive.has(id)) this.gateSmoothed.delete(id);

      const gateYes = gateVotes.filter((v) => v === "yes").length;
      const gateNo = gateVotes.filter((v) => v === "no").length;
      const gateSeen = this.rule.combine === "any" ? gateYes > 0 : gateYes > 0 && gateNo === 0;
      // Arming only ever turns on here; firing is what turns it back off,
      // below. A camera that briefly loses the arming class shouldn't
      // un-arm something already earned.
      if (gateSeen) this.armed = true;
    }

    const cooling =
      this.lastFiredAt !== null && now - this.lastFiredAt < this.rule.cooldownSeconds * 1000;

    let fired = false;
    const gateOpen = !this.rule.requireAfterClassId || this.armed;
    if (condition && this.heldMs >= this.rule.dwellSeconds * 1000 && !cooling && gateOpen) {
      fired = true;
      this.lastFiredAt = now;
      if (this.rule.requireAfterClassId) this.armed = false;
    }

    return {
      condition,
      heldMs: this.heldMs,
      fired,
      seeing,
      cooling: cooling && !fired,
      unknown,
      scores,
      armed: this.armed,
    };
  }
}
