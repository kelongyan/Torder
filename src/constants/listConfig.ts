export const draculaListColors = {
  purple: "#bd93f9",
  green: "#50fa7b",
  cyan: "#8be9fd",
  pink: "#ff79c6",
  orange: "#ffb86c",
} as const;

export const DEFAULT_LIST_COLOR = draculaListColors.purple;

export const defaultListColors = {
  work: draculaListColors.purple,
  personal: draculaListColors.green,
  study: draculaListColors.cyan,
} as const;
