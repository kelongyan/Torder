export const reminderPresets = [
  { value: 0, label: "到期当天" },
  { value: 60, label: "提前 1 小时" },
  { value: 120, label: "提前 2 小时" },
  { value: 1440, label: "提前 1 天" },
  { value: 2880, label: "提前 2 天" },
  { value: 10080, label: "提前 1 周" },
] as const;

export const reminderOptions = [
  { value: -1, label: "不提醒" },
  ...reminderPresets.map((preset) => ({
    value: preset.value,
    label: preset.label,
  })),
];

export function describeReminder(minutes: number | null): string {
  if (minutes === null) return "不提醒";
  const preset = reminderPresets.find((p) => p.value === minutes);
  if (preset) return preset.label;
  if (minutes < 60) return `提前 ${minutes} 分钟`;
  if (minutes < 1440) return `提前 ${Math.round(minutes / 60)} 小时`;
  return `提前 ${Math.round(minutes / 1440)} 天`;
}
