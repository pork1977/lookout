/**
 * Starter ideas, shared by the homepage gallery and the builder's first step.
 *
 * Each one carries its own class names rather than deriving them from the
 * description: "Notice when my coffee mug is empty" needs the pair
 * "Empty mug" / "Mug has coffee", and no amount of string munging gets there.
 * Good defaults here are what stop someone stalling on the blank-page problem.
 */
export interface Preset {
  id: string;
  label: string;
  /** Prefilled into the description field, in the user's own voice. */
  description: string;
  /** The buckets they'll sort photos into. Two is the common case. */
  classes: [string, string];
}

export interface PresetCategory {
  name: string;
  presets: Preset[];
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    name: "About you",
    presets: [
      {
        id: "drink-at-desk",
        label: "When I bring a drink to my desk",
        description: "Notice when I bring a drink to my desk",
        classes: ["Drink at my desk", "No drink"],
      },
      {
        id: "slouching",
        label: "When I've been slouching",
        description: "Notice when I've been slouching",
        classes: ["Slouching", "Sitting upright"],
      },
      {
        id: "on-phone",
        label: "When I'm on my phone instead of working",
        description: "Notice when I'm on my phone instead of working",
        classes: ["On my phone", "Not on my phone"],
      },
      {
        id: "headphones",
        label: "When I put my headphones on",
        description: "Notice when I put my headphones on",
        classes: ["Headphones on", "Headphones off"],
      },
    ],
  },
  {
    name: "Home",
    presets: [
      {
        id: "someone-behind",
        label: "When someone walks into the room behind me",
        description: "Notice when someone walks into the room behind me",
        classes: ["Someone behind me", "Room is empty"],
      },
      {
        id: "dog-on-couch",
        label: "When the dog jumps on the couch",
        description: "Notice when the dog jumps on the couch",
        classes: ["Dog on the couch", "Couch is clear"],
      },
      {
        id: "delivery",
        label: "When a delivery shows up at the door",
        description: "Notice when a delivery shows up at the door",
        classes: ["Parcel at the door", "Nothing at the door"],
      },
    ],
  },
  {
    name: "Office & focus",
    presets: [
      {
        id: "shoulder-surfer",
        label: "When someone walks up behind me",
        description: "Notice when someone walks up behind me",
        classes: ["Someone approaching", "All clear"],
      },
      {
        id: "away-from-desk",
        label: "When I've left my desk for a while",
        description: "Notice when I've left my desk for a while",
        classes: ["Desk is empty", "I'm at my desk"],
      },
      {
        id: "empty-mug",
        label: "When my coffee mug is empty",
        description: "Notice when my coffee mug is empty",
        classes: ["Empty mug", "Mug has coffee"],
      },
    ],
  },
  {
    name: "Whatever you want",
    presets: [
      {
        id: "blank",
        label: "Start from a blank page",
        description: "",
        classes: ["What I'm looking for", "Everything else"],
      },
    ],
  },
];

export const ALL_PRESETS: Preset[] = PRESET_CATEGORIES.flatMap((c) => c.presets);
