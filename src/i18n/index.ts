// i18n bootstrap for Irium Core.
//
// Detection order: localStorage (key `irium_language`) → browser navigator → fallback to English.
// 15 supported languages are listed below with native display names. Arabic is the only RTL
// language; all others are LTR. Translation status per file is captured in each locale's
// _meta object so the UI can flag machine-translated locales that still need human review.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import tr from './locales/tr.json';
import id from './locales/id.json';
import vi from './locales/vi.json';
import it from './locales/it.json';

export type LanguageCode =
  | 'en' | 'ar' | 'hi' | 'es' | 'fr' | 'pt' | 'ru'
  | 'zh' | 'ja' | 'ko' | 'de' | 'tr' | 'id' | 'vi' | 'it';

export interface SupportedLanguage {
  code: LanguageCode;
  nativeName: string;   // shown in the language picker — always in the script of the language
  englishName: string;  // shown as a subtitle for sighted English readers
  dir: 'ltr' | 'rtl';
}

// Order: English first (default), then alphabetical-by-English-name. Picker is rendered
// in this order so users can find their language quickly without scrolling past unfamiliar
// scripts at the top.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', nativeName: 'English',           englishName: 'English',           dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية',           englishName: 'Arabic',            dir: 'rtl' },
  { code: 'zh', nativeName: '中文',               englishName: 'Chinese',           dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch',           englishName: 'German',            dir: 'ltr' },
  { code: 'es', nativeName: 'Español',           englishName: 'Spanish',           dir: 'ltr' },
  { code: 'fr', nativeName: 'Français',          englishName: 'French',            dir: 'ltr' },
  { code: 'hi', nativeName: 'हिन्दी',              englishName: 'Hindi',             dir: 'ltr' },
  { code: 'id', nativeName: 'Bahasa Indonesia',  englishName: 'Indonesian',        dir: 'ltr' },
  { code: 'it', nativeName: 'Italiano',          englishName: 'Italian',           dir: 'ltr' },
  { code: 'ja', nativeName: '日本語',             englishName: 'Japanese',          dir: 'ltr' },
  { code: 'ko', nativeName: '한국어',             englishName: 'Korean',            dir: 'ltr' },
  { code: 'pt', nativeName: 'Português',         englishName: 'Portuguese',        dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский',           englishName: 'Russian',           dir: 'ltr' },
  { code: 'tr', nativeName: 'Türkçe',            englishName: 'Turkish',           dir: 'ltr' },
  { code: 'vi', nativeName: 'Tiếng Việt',        englishName: 'Vietnamese',        dir: 'ltr' },
];

export function getLanguageMeta(code: string): SupportedLanguage | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      hi: { translation: hi },
      es: { translation: es },
      fr: { translation: fr },
      pt: { translation: pt },
      ru: { translation: ru },
      zh: { translation: zh },
      ja: { translation: ja },
      ko: { translation: ko },
      de: { translation: de },
      tr: { translation: tr },
      id: { translation: id },
      vi: { translation: vi },
      it: { translation: it },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true, // accept 'en-US', 'pt-BR' etc and resolve to base
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'irium_language',
      caches: ['localStorage'],
    },
    returnEmptyString: false, // empty translation falls back to English
  });

export default i18n;
