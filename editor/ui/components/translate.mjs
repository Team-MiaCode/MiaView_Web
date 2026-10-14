import { catalogues } from "./labels.mjs";

export function translate(key, language = "zh") {
  const selected = language === "system" ? navigator.language.split("-")[0] : language;
  return (catalogues[selected] || catalogues.zh)[key];
}

export function formatMessage(template, ...values) {
  return template.replace(/%(\d+)/g, (_, index) => String(values[Number(index) - 1]));
}
