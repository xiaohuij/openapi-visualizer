import { useSyncExternalStore } from "react";
import { en, type Dictionary, type TranslationKey } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";

const STORAGE_KEY = "openapi-visualizer-locale";
const dictionaries: Record<Locale, Dictionary> = { en, "zh-CN": zhCN };

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh-CN") return stored;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some(language => language?.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

let currentLocale = detectLocale();
const listeners = new Set<() => void>();

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

applyDocumentLocale(currentLocale);

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, locale);
  applyDocumentLocale(locale);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export function t(key: TranslationKey, variables?: Record<string, string | number>) {
  const dictionary = dictionaries[currentLocale] ?? en;
  let value = dictionary[key] ?? en[key] ?? key;
  if (variables) {
    for (const [name, replacement] of Object.entries(variables)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}

export function useT() {
  useLocale();
  return t;
}
