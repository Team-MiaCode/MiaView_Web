export function uiFontFamily(language = "zh") {
  if (language.startsWith("zh")) return '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  if (language.startsWith("ja")) return '"Yu Gothic UI", "Meiryo UI", "Meiryo", "Noto Sans CJK JP", sans-serif';
  return '"Segoe UI", system-ui, sans-serif';
}
