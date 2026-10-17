import { useEffect, useMemo, useState } from "react";
import {
  checkLiveBackendHealth,
  fetchPendingJournals,
  fetchWorkingPaperPack,
} from "@/api/client";

/* ==========================================================================
   Prototype data layer.

   Deliberately wired to the SAME live API and the SAME label localiser as the
   shipping app, so the comparison is apples-to-apples: only the interface
   changes between these prototypes and the current build.

   No invented figures anywhere — every number on these screens comes from the
   statement pack, or it is not shown.
   ========================================================================== */

/**
 * The API ships accounting_standard as an enum ("AASB_TIER2"). Printing raw
 * enums is the same class of leak as the trial balance's "BALANCE_SHEET (B/S)" column, so
 * map them to their display names here.
 */
export const STANDARD_LABELS: Record<string, string> = {
  AASB_TIER2: "AASB Tier 2",
  PRC_SMALL: "PRC CAS (小企業會計準則)",
  SME_FRS_HK: "HK SME-FRS",
  SFRS_SMALL: "SFRS for Small Entities",
  US_GAAP: "US GAAP",
  IFRS: "IFRS",
};


/**
 * Close-checklist notes arrive as English backend prose. The note belongs to
 * the checklist code, so translate it here instead of printing English inside
 * a Chinese interface (the same reasoning as `localizeDestination`).
 */
const CHECKLIST_NOTES: Record<string, Record<Lang, string>> = {
  BANK_REC_WP_A: {
    "zh-CN": "桌面单机模式未接入 Open Banking 实时流水，需人工完成银行对账并上传对账单。",
    "zh-TW": "桌面單機模式未接入 Open Banking 即時流水，需人工完成銀行對賬並上載對賬單。",
    en: "Open Banking live feed is not available in standalone desktop mode. Manual bank reconciliation is required.",
  },
  OWNER_SPLIT_WP_DD: {
    "zh-CN": "本期公私混用支出已全部拆分，私人部分计入股东往来。",
    "zh-TW": "本期公私混用支出已全部拆分，私人部分計入股東往來。",
    en: "All mixed personal/business expenses were apportioned; the personal share went to the director account.",
  },
  PREPAY_FA_AJE_WP_CF: {
    "zh-CN": "预付摊销与固定资产折旧的月末调整分录已过账。",
    "zh-TW": "預付攤銷與固定資產折舊的月末調整分錄已過賬。",
    en: "Month-end prepaid amortisation and depreciation adjusting entries are posted.",
  },
  STATUTORY_TAX_WP_CC: {
    "zh-CN": "法定申报格位与预留税款已按当地税制测算并留痕。",
    "zh-TW": "法定申報格位與預留稅款已按當地稅制測算並留痕。",
    en: "Statutory return boxes and the tax reserve were computed under the local regime and documented.",
  },
  THREE_STMT_PROOF: {
    "zh-CN": "三大报表勾稽通过：资产 ＝ 负债 ＋ 权益，现金流量表与货币资金一致。",
    "zh-TW": "三大報表勾稽通過：資產 ＝ 負債 ＋ 權益，現金流量表與貨幣資金一致。",
    en: "Three-statement proof passed: A = L + E, and cash flow agrees to balance sheet cash.",
  },
  CPA_FINAL_LOCK: {
    "zh-CN": "本期事项已处理完毕，待会计师签核后当期账目将锁定为只读。",
    "zh-TW": "本事項已處理完畢，待會計師簽核後當期賬目將鎖定為唯讀。",
    en: "This period is complete. Sign-off locks the books to read-only.",
  },
};

export function checklistNote(code: string | undefined, fallback: string | undefined, lang: Lang): string {
  if (code && CHECKLIST_NOTES[code]) return CHECKLIST_NOTES[code][lang];
  return fallback ?? "";
}

export function standardLabel(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return STANDARD_LABELS[value] ?? value;
}

export const ENTITIES = [
  { code: "AU-OPC-01", name: "Spark AI Studio Pty Ltd", standard: "AASB Tier 2" },
  { code: "CN-OPC-01", name: "上海智算一人有限公司", standard: "小企業會計準則" },
  { code: "HK-SME-01", name: "Pacific Nexus Tech Limited", standard: "SME-FRS" },
  { code: "SG-OPC-01", name: "Merlion Autonomous Labs Pte. Ltd.", standard: "SFRS for Small Entities" },
  { code: "US-SOLE-01", name: "Griffin Analytics LLC", standard: "US GAAP" },
  { code: "EU-OPC-01", name: "rheinAI Cloud UG / GmbH", standard: "IFRS / HGB" },
];

export const PERIODS = ["2026-10", "2026-09", "2026-Q3"];

export interface PackState {
  pack: any | null;
  pendingCount: number;
  live: boolean;
  loading: boolean;
  error: string | null;
}

export function usePack(entityCode: string, period: string): PackState {
  const [state, setState] = useState<PackState>({
    pack: null,
    pendingCount: 0,
    live: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const live = await checkLiveBackendHealth();
        const [pack, pending] = await Promise.all([
          fetchWorkingPaperPack(entityCode, period),
          fetchPendingJournals(entityCode),
        ]);
        if (cancelled) return;
        setState({
          pack,
          live,
          pendingCount: (pending?.journals || []).length,
          loading: false,
          error: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        setState({ pack: null, pendingCount: 0, live: false, loading: false, error: String(err?.message || err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityCode, period]);

  return state;
}

/* ==========================================================================
   Prototype-only copy. Product copy that already exists in the app
   dictionary is reused via useI18n(); this object covers the strings these
   three new screens introduce.
   ========================================================================== */
type Lang = "zh-CN" | "zh-TW" | "en";

export const PROTO: Record<string, Record<Lang, string>> = {
  protoBarLabel: { "zh-CN": "UI 原型", "zh-TW": "UI 原型", en: "UI prototype" },
  protoBarNote: {
    "zh-CN": "三个原型使用同一份实时数据与同一套标签本地化，仅界面不同。",
    "zh-TW": "三個原型使用同一份即時數據與同一套標籤本地化，僅介面不同。",
    en: "All three prototypes read the same live data and the same label localiser — only the interface differs.",
  },
  p01: { "zh-CN": "报表", "zh-TW": "報表", en: "Statements" },
  p02: { "zh-CN": "概览", "zh-TW": "概覽", en: "Overview" },
  p03: { "zh-CN": "记账", "zh-TW": "記賬", en: "Bookkeeping" },
  density: { "zh-CN": "密度", "zh-TW": "密度", en: "Density" },
  dense: { "zh-CN": "紧凑", "zh-TW": "緊湊", en: "Compact" },
  comfy: { "zh-CN": "舒适", "zh-TW": "舒適", en: "Comfortable" },
  navTrialBalance: { "zh-CN": "试算表", "zh-TW": "試算表", en: "Trial balance" },
  navClose: { "zh-CN": "结账", "zh-TW": "結帳", en: "Close" },
  thisPeriod: { "zh-CN": "本期要点", "zh-TW": "本期要點", en: "This period" },
  proofs: { "zh-CN": "勾稽证明", "zh-TW": "勾稽證明", en: "Reconciliation proof" },
  proofPassed: { "zh-CN": "通过", "zh-TW": "通過", en: "Passed" },
  proofFailed: { "zh-CN": "不符", "zh-TW": "不符", en: "Failed" },
  bsEquation: { "zh-CN": "资产 ＝ 负债 ＋ 权益", "zh-TW": "資產 ＝ 負債 ＋ 權益", en: "Assets = Liabilities + Equity" },
  cfTie: { "zh-CN": "现金流量表期末现金 ＝ 资产负债表货币资金", "zh-TW": "現金流量表期末現金 ＝ 資產負債表貨幣資金", en: "CF ending cash = BS cash" },
  utbBalanced: { "zh-CN": "UTB 借贷合计", "zh-TW": "UTB 借貸合計", en: "UTB debits = credits" },
  npToEquity: { "zh-CN": "本期净利润结转权益", "zh-TW": "本期淨利結轉權益", en: "Net profit flows to equity" },
  inspect: { "zh-CN": "透视", "zh-TW": "透視", en: "Inspect" },
  inspectHint: {
    "zh-CN": "选中任一行查看其总账组成",
    "zh-TW": "選中任一行以檢視其總賬組成",
    en: "Select a row to see the accounts behind it",
  },
  composedOf: { "zh-CN": "由以下科目组成", "zh-TW": "由以下科目組成", en: "Composed of" },
  quickJump: { "zh-CN": "快速跳转", "zh-TW": "快速跳轉", en: "Quick jump" },
  searchPlaceholder: {
    "zh-CN": "搜索科目或操作…",
    "zh-TW": "搜尋科目或操作…",
    en: "Search accounts or actions…",
  },
  noResults: { "zh-CN": "无匹配结果", "zh-TW": "無相符結果", en: "No matches" },
  groupAccounts: { "zh-CN": "科目", "zh-TW": "科目", en: "Accounts" },
  groupActions: { "zh-CN": "操作", "zh-TW": "操作", en: "Actions" },
  printPack: { "zh-CN": "打印报表", "zh-TW": "列印報表", en: "Print statements" },
  exportPdf: { "zh-CN": "导出 PDF", "zh-TW": "匯出 PDF", en: "Export PDF" },
  runClose: { "zh-CN": "执行结账", "zh-TW": "執行結賬", en: "Run close" },
  lastUpdated: { "zh-CN": "最后更新", "zh-TW": "最後更新", en: "Updated" },
  online: { "zh-CN": "在线", "zh-TW": "線上", en: "Online" },
  offline: { "zh-CN": "离线", "zh-TW": "離線", en: "Offline" },
  drCrTotal: { "zh-CN": "借贷合计", "zh-TW": "借貸合計", en: "Debit / credit total" },
  standard: { "zh-CN": "会计准则", "zh-TW": "會計準則", en: "Standard" },
  preparedBy: { "zh-CN": "编制人", "zh-TW": "編制人", en: "Prepared by" },
  reviewedBy: { "zh-CN": "复核人", "zh-TW": "複核人", en: "Reviewed by" },
  signedOn: { "zh-CN": "签核日期", "zh-TW": "簽核日期", en: "Signed on" },
  checklist: { "zh-CN": "结账清单", "zh-TW": "結賬清單", en: "Close checklist" },
  done: { "zh-CN": "已完成", "zh-TW": "已完成", en: "Done" },
  todo: { "zh-CN": "待处理", "zh-TW": "待處理", en: "To do" },
  attention: { "zh-CN": "注意", "zh-TW": "注意", en: "Attention" },
  safeToSpend: { "zh-CN": "可动用现金", "zh-TW": "可動用現金", en: "Safe to spend" },
  netProfit: { "zh-CN": "本月净利润", "zh-TW": "本月淨利潤", en: "Net profit" },
  taxReserve: { "zh-CN": "税款准备", "zh-TW": "稅款準備", en: "Tax reserve" },
  whyThis: { "zh-CN": "为什么是这个数", "zh-TW": "為什麼是這個數", en: "Why this number" },
  todoThisMonth: { "zh-CN": "本月要做的事", "zh-TW": "本月要做的事", en: "Do this month" },
  cashBridge: { "zh-CN": "现金去向", "zh-TW": "現金去向", en: "Where the cash went" },
  opening: { "zh-CN": "期初现金", "zh-TW": "期初現金", en: "Opening cash" },
  operating: { "zh-CN": "经营活动", "zh-TW": "經營活動", en: "Operating" },
  investing: { "zh-CN": "投资活动", "zh-TW": "投資活動", en: "Investing" },
  financing: { "zh-CN": "筹资活动", "zh-TW": "籌資活動", en: "Financing" },
  closing: { "zh-CN": "期末现金", "zh-TW": "期末現金", en: "Closing cash" },
  completeness: { "zh-CN": "结账进度", "zh-TW": "結帳進度", en: "Close progress" },
  awaitingCpa: { "zh-CN": "待会计师签核", "zh-TW": "待會計師簽核", en: "Awaiting CPA sign-off" },
  locked: { "zh-CN": "已签核封存", "zh-TW": "已簽核封存", en: "Signed & locked" },
  openDetail: { "zh-CN": "查看明细", "zh-TW": "查看明細", en: "Open detail" },
  net: { "zh-CN": "净额", "zh-TW": "淨額", en: "Net" },
  directorLoan: { "zh-CN": "股东往来", "zh-TW": "股東往來", en: "Director / owner account" },
  owedToFounder: { "zh-CN": "公司欠创办人", "zh-TW": "公司欠創辦人", en: "Owed to founder" },
  owedByFounder: { "zh-CN": "创办人欠公司", "zh-TW": "創辦人欠公司", en: "Owed by founder" },
  plainLanguage: { "zh-CN": "白话", "zh-TW": "白話", en: "Plain words" },
  kpiVsRevenue: { "zh-CN": "占收入", "zh-TW": "占收入", en: "of revenue" },
  notPerformed: { "zh-CN": "未执行", "zh-TW": "未執行", en: "Not performed" },
  rows: { "zh-CN": "行", "zh-TW": "行", en: "rows" },
};

export function useProtoCopy(lang: Lang) {
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(PROTO)) out[key] = value[lang] ?? value["zh-TW"];
    return out as Record<keyof typeof PROTO, string>;
  }, [lang]);
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
