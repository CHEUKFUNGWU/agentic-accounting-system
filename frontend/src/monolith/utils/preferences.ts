export type AppLanguage = 'en' | 'zh' | 'es' | 'ja';
export type AppFontSize = 'sm' | 'md' | 'lg';
export type AppTheme = 'light' | 'dark';
export type AppFontFamily = 'inter' | 'jakarta' | 'jetbrains';

export interface AppPreferences {
  language: AppLanguage;
  fontSize: AppFontSize;
  theme: AppTheme;
  fontFamily?: AppFontFamily;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  language: 'en',
  fontSize: 'md',
  theme: 'light',
  fontFamily: 'inter',
};

export const FONT_SIZE_ROOT_PX: Record<AppFontSize, string> = {
  sm: '14.5px',
  md: '16px',
  lg: '17.5px',
};

export const LANGUAGE_OPTIONS: {
  id: AppLanguage;
  code: string;
  nativeLabel: string;
}[] = [
  { id: 'en', code: 'EN', nativeLabel: 'English' },
  { id: 'zh', code: 'ZH', nativeLabel: '简体中文' },
  { id: 'es', code: 'ES', nativeLabel: 'Español' },
  { id: 'ja', code: 'JA', nativeLabel: '日本語' },
];

export const FONT_SIZE_OPTIONS: {
  id: AppFontSize;
  label: string;
  scaleLabel: string;
  pxValue: string;
}[] = [
  { id: 'sm', label: 'Compact', scaleLabel: 'A-', pxValue: '14.5px' },
  { id: 'md', label: 'Default', scaleLabel: 'A', pxValue: '16px' },
  { id: 'lg', label: 'Large', scaleLabel: 'A+', pxValue: '17.5px' },
];

export const FONT_FAMILY_OPTIONS: {
  id: AppFontFamily;
  name: string;
}[] = [
  { id: 'inter', name: 'Inter' },
  { id: 'jakarta', name: 'Plus Jakarta Sans' },
  { id: 'jetbrains', name: 'JetBrains Mono' },
];

export interface UITranslations {
  nav: {
    overview: string;
    journal: string;
    ledger: string;
    receivables: string;
    payables: string;
    fixedAssets: string;
    trialBalance: string;
    statements: string;
    budgeting: string;
    forecasting: string;
    reconciliation: string;
    tax: string;
    periodClose: string;
    auditLog: string;
    settings: string;
    newEntry: string;
  };
  search: {
    placeholder: string;
    quickLookup: string;
    all: string;
    journals: string;
    accounts: string;
    bank: string;
    close: string;
    noMatches: string;
    matchesSingle: string;
    matchesPlural: string;
  };
  settings: {
    pageTitle: string;
    appearanceTitle: string;
    lightModeTitle: string;
    darkModeTitle: string;
    typographyTitle: string;
    fontSizeTitle: string;
    languageTitle: string;
    resetDefaults: string;
  };
}

export const TRANSLATIONS: Record<AppLanguage, UITranslations> = {
  en: {
    nav: {
      overview: 'Overview',
      journal: 'Journal Entry',
      ledger: 'General Ledger',
      receivables: 'Receivables',
      payables: 'Payables',
      fixedAssets: 'Fixed Assets',
      trialBalance: 'Trial Balance',
      statements: 'Statements',
      budgeting: 'Budgeting',
      forecasting: 'Forecasting',
      reconciliation: 'Reconciliation',
      tax: 'Tax',
      periodClose: 'Period Close',
      auditLog: 'Audit Log',
      settings: 'Settings',
      newEntry: 'New Entry',
    },
    search: {
      placeholder: 'Search journal entries, GL accounts, or bank transactions...',
      quickLookup: 'QUICK LOOKUP:',
      all: 'All',
      journals: 'Journal Entries',
      accounts: 'Accounts',
      bank: 'Bank Transactions',
      close: 'Close',
      noMatches: 'No matches for',
      matchesSingle: 'match',
      matchesPlural: 'matches',
    },
    settings: {
      pageTitle: 'Settings',
      appearanceTitle: 'Theme',
      lightModeTitle: 'Light',
      darkModeTitle: 'Dark',
      typographyTitle: 'Font',
      fontSizeTitle: 'Font Size',
      languageTitle: 'Language',
      resetDefaults: 'Reset',
    },
  },
  zh: {
    nav: {
      overview: '财务总览',
      journal: '会计分录',
      ledger: '总分类账',
      receivables: '应收账款',
      payables: '应付账款',
      fixedAssets: '固定资产',
      trialBalance: '试算平衡',
      statements: '财务报表',
      budgeting: '全面预算',
      forecasting: '滚动预测',
      reconciliation: '银行对账',
      tax: '税务申报',
      periodClose: '期末结账',
      auditLog: '审计日志',
      settings: '设置',
      newEntry: '新增分录',
    },
    search: {
      placeholder: '搜索会计分录、总账科目或银行流水...',
      quickLookup: '快捷检索:',
      all: '全部',
      journals: '会计分录',
      accounts: '总账科目',
      bank: '银行流水',
      close: '关闭',
      noMatches: '未找到匹配结果:',
      matchesSingle: '项',
      matchesPlural: '项',
    },
    settings: {
      pageTitle: '设置',
      appearanceTitle: '主题模式',
      lightModeTitle: '浅色',
      darkModeTitle: '深色',
      typographyTitle: '字体',
      fontSizeTitle: '字号大小',
      languageTitle: '语言',
      resetDefaults: '重置',
    },
  },
  es: {
    nav: {
      overview: 'Resumen',
      journal: 'Asientos',
      ledger: 'Libro Mayor',
      receivables: 'Por Cobrar',
      payables: 'Por Pagar',
      fixedAssets: 'Activos Fijos',
      trialBalance: 'Balance Comp.',
      statements: 'Estados Fin.',
      budgeting: 'Presupuesto',
      forecasting: 'Proyecciones',
      reconciliation: 'Conciliación',
      tax: 'Impuestos',
      periodClose: 'Cierre Contable',
      auditLog: 'Auditoría',
      settings: 'Ajustes',
      newEntry: 'Nuevo Asiento',
    },
    search: {
      placeholder: 'Buscar asientos, cuentas o transacciones bancarias...',
      quickLookup: 'BÚSQUEDA RÁPIDA:',
      all: 'Todo',
      journals: 'Asientos',
      accounts: 'Cuentas GL',
      bank: 'Transacciones',
      close: 'Cerrar',
      noMatches: 'Sin resultados para',
      matchesSingle: 'resultado',
      matchesPlural: 'resultados',
    },
    settings: {
      pageTitle: 'Ajustes',
      appearanceTitle: 'Tema',
      lightModeTitle: 'Claro',
      darkModeTitle: 'Oscuro',
      typographyTitle: 'Fuente',
      fontSizeTitle: 'Tamaño',
      languageTitle: 'Idioma',
      resetDefaults: 'Restablecer',
    },
  },
  ja: {
    nav: {
      overview: '概要',
      journal: '仕訳入力',
      ledger: '総勘定元帳',
      receivables: '売掛金管理',
      payables: '買掛金管理',
      fixedAssets: '固定資産',
      trialBalance: '試算表',
      statements: '財務諸表',
      budgeting: '予算管理',
      forecasting: '業績予測',
      reconciliation: '銀行照合',
      tax: '税務申告',
      periodClose: '月次決算',
      auditLog: '監査ログ',
      settings: '設定',
      newEntry: '新規仕訳',
    },
    search: {
      placeholder: '仕訳、勘定科目、銀行取引を検索...',
      quickLookup: 'クイック検索:',
      all: 'すべて',
      journals: '仕訳帳',
      accounts: '勘定科目',
      bank: '銀行取引',
      close: '閉じる',
      noMatches: '一致なし:',
      matchesSingle: '件',
      matchesPlural: '件',
    },
    settings: {
      pageTitle: '設定',
      appearanceTitle: 'テーマ',
      lightModeTitle: 'ライト',
      darkModeTitle: 'ダーク',
      typographyTitle: 'フォント',
      fontSizeTitle: '文字サイズ',
      languageTitle: '言語',
      resetDefaults: 'リセット',
    },
  },
};

export function getTranslations(lang: AppLanguage): UITranslations {
  return TRANSLATIONS[lang] ?? TRANSLATIONS.en;
}
