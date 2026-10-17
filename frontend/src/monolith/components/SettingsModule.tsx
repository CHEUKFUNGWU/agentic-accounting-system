import React from 'react';
import {
  AppPreferences,
  DEFAULT_PREFERENCES,
  LANGUAGE_OPTIONS,
  FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  getTranslations,
} from '../utils/preferences';
import { Sun, Moon, RotateCcw } from 'lucide-react';

interface SettingsModuleProps {
  preferences: AppPreferences;
  onUpdatePreferences: (updates: Partial<AppPreferences>) => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  preferences,
  onUpdatePreferences,
}) => {
  const t = getTranslations(preferences.language);
  const currentFontFamily = preferences.fontFamily || 'inter';

  return (
    <section
      aria-label="Settings"
      className="bg-white border border-zinc-200 divide-y divide-zinc-200"
    >
      {/* Header Row */}
      <div className="px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-950">{t.settings.pageTitle}</h2>
        <button
          type="button"
          onClick={() => onUpdatePreferences(DEFAULT_PREFERENCES)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t.settings.resetDefaults}</span>
        </button>
      </div>

      {/* 1. Theme (Light / Dark) */}
      <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <span className="text-xs font-semibold text-zinc-950">
          {t.settings.appearanceTitle}
        </span>

        <div className="grid grid-cols-2 gap-2 sm:w-72">
          <button
            type="button"
            aria-pressed={preferences.theme === 'light'}
            onClick={() => onUpdatePreferences({ theme: 'light' })}
            className={`px-3.5 py-2 text-xs font-medium border flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              preferences.theme === 'light'
                ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-950 hover:text-zinc-950'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>{t.settings.lightModeTitle}</span>
          </button>

          <button
            type="button"
            aria-pressed={preferences.theme === 'dark'}
            onClick={() => onUpdatePreferences({ theme: 'dark' })}
            className={`px-3.5 py-2 text-xs font-medium border flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              preferences.theme === 'dark'
                ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-950 hover:text-zinc-950'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>{t.settings.darkModeTitle}</span>
          </button>
        </div>
      </div>

      {/* 2. Language */}
      <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <span className="text-xs font-semibold text-zinc-950">
          {t.settings.languageTitle}
        </span>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:w-[440px]">
          {LANGUAGE_OPTIONS.map((lang) => {
            const isSelected = preferences.language === lang.id;
            return (
              <button
                key={lang.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onUpdatePreferences({ language: lang.id })}
                className={`px-3 py-2 text-xs font-medium border flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-950 hover:text-zinc-950'
                }`}
              >
                <span className="opacity-60 text-[10px]">{lang.code}</span>
                <span>{lang.nativeLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Font Size */}
      <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <span className="text-xs font-semibold text-zinc-950">
          {t.settings.fontSizeTitle}
        </span>

        <div className="grid grid-cols-3 gap-2 sm:w-[440px]">
          {FONT_SIZE_OPTIONS.map((sz) => {
            const isSelected = preferences.fontSize === sz.id;
            return (
              <button
                key={sz.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onUpdatePreferences({ fontSize: sz.id })}
                className={`px-3 py-2 text-xs font-medium border flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-950 hover:text-zinc-950'
                }`}
              >
                <span className="font-bold">{sz.scaleLabel}</span>
                <span>{sz.label}</span>
                <span className="text-[10px] opacity-60 tabular-nums">{sz.pxValue}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Font Family */}
      <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <span className="text-xs font-semibold text-zinc-950">
          {t.settings.typographyTitle}
        </span>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:w-[440px]">
          {FONT_FAMILY_OPTIONS.map((font) => {
            const isSelected = currentFontFamily === font.id;
            return (
              <button
                key={font.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onUpdatePreferences({ fontFamily: font.id })}
                className={`px-3 py-2 text-xs font-medium border text-center transition-colors cursor-pointer truncate ${
                  isSelected
                    ? 'bg-zinc-950 text-white border-zinc-950 font-semibold'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-950 hover:text-zinc-950'
                }`}
              >
                {font.name}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
