import React, { createContext, useContext, useState, useEffect } from "react";

export type Language = "zh-CN" | "zh-TW" | "en";

export interface Translations {
  // Navigation
  nav_statements: string;
  nav_etb: string;
  nav_journals: string;
  nav_schedules: string;
  nav_close_tax: string;
  nav_database: string;

  // Header & Status
  app_title: string;
  current_period: string;
  db_connected: string;
  status_awaiting_cpa: string;
  status_locked: string;
  backup_btn: string;
  copy_path: string;
  copied: string;
  print_report: string;

  // Financial Statements
  tab_pnl: string;
  tab_bs: string;
  tab_cfs: string;
  pnl_title: string;
  bs_title: string;
  cfs_title: string;
  statement_ref_col: string;
  account_name_col: string;
  amount_col: string;
  ratio_col: string;
  balance_proof_balanced: string;
  balance_proof_imbalanced: string;
  accounting_period: string;
  currency_label: string;

  // Statements rows
  row_revenue: string;
  row_cogs: string;
  row_gross_profit: string;
  row_opex: string;
  row_ebitda: string;
  row_depreciation: string;
  row_pbt: string;
  row_tax: string;
  row_net_profit: string;
  row_current_assets: string;
  row_cash: string;
  row_ar: string;
  row_prepayments: string;
  row_total_current_assets: string;
  row_non_current_assets: string;
  row_fixed_assets_net: string;
  row_total_assets: string;
  row_current_liabilities: string;
  row_ap: string;
  row_tax_payable: string;
  row_director_loan: string;
  row_total_liabilities: string;
  row_equity: string;
  row_share_capital: string;
  row_retained_earnings: string;
  row_total_equity: string;
  row_total_liabilities_equity: string;
  row_cfs_op: string;
  row_cfs_inv: string;
  row_cfs_fin: string;
  row_cfs_net_change: string;
  row_cfs_open_cash: string;
  row_cfs_close_cash: string;
  row_cfs_addback_dep: string;
  row_cfs_chg_ar: string;
  row_cfs_chg_prepay: string;
  row_cfs_chg_ap: string;
  row_cfs_chg_tax: string;
  row_cfs_direct_in: string;
  row_cfs_direct_out: string;
  row_cfs_direct_tax: string;
  row_cfs_capex: string;
  row_cfs_fin_equity: string;
  row_cfs_fin_loan: string;

  // Trial balance
  tb_detail_title: string;
  tb_detail_subtitle: string;
  col_acc_code: string;
  col_acc_name: string;
  col_open_bal: string;
  col_period_activity: string;
  col_aje: string;
  col_ending_tb: string;
  col_pnl: string;
  col_bs: string;
  dr_label: string;
  cr_label: string;
  total_label: string;
  balanced: string;
  imbalanced: string;
  dest_balance_sheet: string;
  dest_income_statement: string;

  // Journals & Ledger
  journal_title: string;
  journal_subtitle: string;
  btn_split_expense: string;
  btn_add_aje: string;
  filter_all: string;
  filter_pending: string;
  filter_posted: string;
  filter_rejected: string;
  col_voucher_no: string;
  col_date: string;
  col_description: string;
  col_total_dr: string;
  col_total_cr: string;
  col_hash: string;
  col_status: string;
  col_actions: string;
  btn_review: string;
  btn_approve: string;
  btn_reject: string;
  reject_reason_prompt: string;
  reject_reason_placeholder: string;
  confirm_reject: string;
  cancel: string;
  no_journals: string;

  // Schedules
  wp_title: string;
  wp_subtitle: string;
  wp_drawer_title: string;
  wp_variance: string;
  wp_status_tied: string;
  wp_status_not_performed: string;
  wp_note: string;
  wp_evidence_hash: string;
  wp_gl_balance: string;
  wp_subledger_balance: string;
  wp_prepared_by: string;
  wp_reviewed_by: string;
  wp_view_detail: string;
  wp_balanced_status: string;
  wp_items_title: string;
  wp_col_desc: string;
  wp_col_amount: string;
  wp_col_notes: string;
  wp_notes_title: string;
  wp_variance_tied: string;
  wp_not_performed: string;

  // Month-end close & Tax
  close_title: string;
  close_subtitle: string;
  close_checklist: string;
  cpa_sign_btn: string;
  cpa_confirm_modal_title: string;
  cpa_confirm_modal_desc: string;
  cpa_confirm_btn: string;

  // Database & Company File
  db_view_title: string;
  db_view_subtitle: string;
  card_engine: string;
  card_path: string;
  card_size: string;
  card_status: string;
  backup_now: string;
  backup_in_progress: string;
  backup_snapshot_title: string;
  backup_snapshot_desc: string;
}

const zhCN: Translations = {
  nav_statements: "财务报表",
  nav_etb: "扩展试算表",
  nav_journals: "日记账与凭证",
  nav_schedules: "审计",
  nav_close_tax: "月末结账与税务",
  nav_database: "账套与数据库设置",

  app_title: "智能财务系统",
  current_period: "当前会计期间",
  db_connected: "数据库在线",
  status_awaiting_cpa: "待签核",
  status_locked: "已签核封存",
  backup_btn: "备份账套",
  copy_path: "复制路径",
  copied: "已复制",
  print_report: "打印报表",

  tab_pnl: "利润表",
  tab_bs: "资产负债表",
  tab_cfs: "现金流量表",
  pnl_title: "单体利润表",
  bs_title: "单体资产负债表",
  cfs_title: "单体现金流量表",
  statement_ref_col: "索引",
  account_name_col: "报表项目",
  amount_col: "金额",
  ratio_col: "比率",
  balance_proof_balanced: "平衡：资产 ＝ 负债 ＋ 股东权益",
  balance_proof_imbalanced: "试算不平衡：资产 ≠ 负债 ＋ 股东权益",
  accounting_period: "会计期间",
  currency_label: "币种",

  row_revenue: "主营业务收入",
  row_cogs: "减：营业成本与直接交付费用",
  row_gross_profit: "毛利",
  row_opex: "减：管理及营运费用",
  row_ebitda: "息税折旧摊销前利润",
  row_depreciation: "减：折旧及摊销",
  row_pbt: "利润总额（税前利润）",
  row_tax: "减：所得税费用",
  row_net_profit: "本期净利润",
  row_current_assets: "流动资产",
  row_cash: "货币资金 / 银行存款",
  row_ar: "应收账款净额",
  row_prepayments: "预付款项及留抵进项税",
  row_total_current_assets: "流动资产合计",
  row_non_current_assets: "非流动资产",
  row_fixed_assets_net: "固定资产及设备净值",
  row_total_assets: "资产总计",
  row_current_liabilities: "流动负债",
  row_ap: "应付账款及应计费用",
  row_tax_payable: "应交税费",
  row_director_loan: "其他应付款（股东/董事借款往来）",
  row_total_liabilities: "负债合计",
  row_equity: "股东权益",
  row_share_capital: "实收资本",
  row_retained_earnings: "未分配利润（含本期净利）",
  row_total_equity: "股东权益合计",
  row_total_liabilities_equity: "负债及股东权益总计",
  row_cfs_op: "经营活动产生的现金流量净额",
  row_cfs_inv: "投资活动产生的现金流量净额",
  row_cfs_fin: "筹资活动产生的现金流量净额",
  row_cfs_net_change: "现金及现金等价物净增加额",
  row_cfs_open_cash: "加：期初现金余额",
  row_cfs_close_cash: "期末现金及现金等价物余额",
  row_cfs_addback_dep: "加：折旧及摊销",
  row_cfs_chg_ar: "应收账款变动",
  row_cfs_chg_prepay: "预付款项及留抵税额变动",
  row_cfs_chg_ap: "应付账款及应计费用变动",
  row_cfs_chg_tax: "应交税费变动",
  row_cfs_direct_in: "销售商品、提供劳务收到的现金",
  row_cfs_direct_out: "购买商品、接受劳务及运营支付的现金",
  row_cfs_direct_tax: "支付的各项税费",
  row_cfs_capex: "购建固定资产支付的现金",
  row_cfs_fin_equity: "吸收投资或分配股利",
  row_cfs_fin_loan: "股东/业主往来资金变动",

  tb_detail_title: "扩展试算表",
  tb_detail_subtitle: "全科目发生额、月末调整分录与报表结转自动勾稽表",
  col_acc_code: "科目代码",
  col_acc_name: "科目名称",
  col_open_bal: "期初余额",
  col_period_activity: "本期发生额",
  col_aje: "调整分录 (AJE)",
  col_ending_tb: "期末试算表",
  col_pnl: "利润表结转",
  col_bs: "资产负债表结转",
  dr_label: "借方",
  cr_label: "贷方",
  total_label: "借贷合计",
  balanced: "借贷试算平衡",
  imbalanced: "借贷不平",
  dest_balance_sheet: "资产负债表 (B/S)",
  dest_income_statement: "利润表 (P&L)",

  journal_title: "日记账与凭证审核",
  journal_subtitle: "会计凭证流水、公私费用分摊与制单复核权责分离",
  btn_split_expense: "记一笔公私费用分摊",
  btn_add_aje: "提列调整分录 (AJE)",
  filter_all: "全部凭证",
  filter_pending: "待复核",
  filter_posted: "已过账",
  filter_rejected: "已驳回",
  col_voucher_no: "凭证编号",
  col_date: "记账日期",
  col_description: "业务摘要",
  col_total_dr: "借方合计",
  col_total_cr: "贷方合计",
  col_hash: "防伪指纹",
  col_status: "状态",
  col_actions: "操作",
  btn_review: "审核凭证",
  btn_approve: "核准并过账",
  btn_reject: "驳回凭证",
  reject_reason_prompt: "请填写驳回原因：",
  reject_reason_placeholder: "例：业务事由不明确，请补充发票凭据与商用比例证明",
  confirm_reject: "确认驳回",
  cancel: "取消",
  no_journals: "暂无符合条件的日记账记录",

  wp_title: "审计工作索引",
  wp_subtitle: "总账与明细账勾稽核对表",
  wp_drawer_title: "核验详情",
  wp_variance: "勾稽差额",
  wp_status_tied: "账实相符",
  wp_status_not_performed: "待核对外部对账单",
  wp_note: "核算标记说明",
  wp_evidence_hash: "原始指纹",
  wp_gl_balance: "总账余额",
  wp_subledger_balance: "明细账余额",
  wp_prepared_by: "编制人",
  wp_reviewed_by: "复核人",
  wp_view_detail: "查看审计明细",
  wp_balanced_status: "勾稽相符 (0.00)",
  wp_items_title: "明细抽核清单",
  wp_col_desc: "项目说明",
  wp_col_amount: "金额",
  wp_col_notes: "备注 / 证明索引",
  wp_notes_title: "审计附注与核验说明",
  wp_variance_tied: "勾稽差额：0.00（账实相符）",
  wp_not_performed: "未执行（未取得外部核对来源）",

  close_title: "月末结账与税务申报",
  close_subtitle: "期末检查清单、公私账分离审核与注册会计师签核封存",
  close_checklist: "结账核验程序清单",
  cpa_sign_btn: "注册会计师签核封存",
  cpa_confirm_modal_title: "确认进行期末签核封存？",
  cpa_confirm_modal_desc: "封存后当期会计账目将被锁定为只读状态，不可再直接追加分录或调整凭证。",
  cpa_confirm_btn: "确认封存",

  db_view_title: "账套与数据库设置",
  db_view_subtitle: "企业账套持久化存储、连接状态与备份快照",
  card_engine: "数据库引擎",
  card_path: "连接信息 / 存储路径",
  card_size: "账套数据大小",
  card_status: "存储状态",
  backup_now: "立即备份账套",
  backup_in_progress: "正在备份...",
  backup_snapshot_title: "建立即时账套快照备份",
  backup_snapshot_desc: "生成当前账套的独立只读副本，用于税务审计归档或灾备。",
};

const zhTW: Translations = {
  nav_statements: "財務報表",
  nav_etb: "擴展試算表",
  nav_journals: "日記賬與憑證",
  nav_schedules: "審計",
  nav_close_tax: "月末結賬與稅務",
  nav_database: "賬套與資料庫設置",

  app_title: "智能財務系統",
  current_period: "當前會計期間",
  db_connected: "資料庫連線正常",
  status_awaiting_cpa: "待簽核",
  status_locked: "已簽核封存",
  backup_btn: "備份賬套",
  copy_path: "複製路徑",
  copied: "已複製",
  print_report: "列印報表",

  tab_pnl: "損益表",
  tab_bs: "資產負債表",
  tab_cfs: "現金流量表",
  pnl_title: "單體損益表",
  bs_title: "單體資產負債表",
  cfs_title: "單體現金流量表",
  statement_ref_col: "索引",
  account_name_col: "報表項目",
  amount_col: "金額",
  ratio_col: "比率",
  balance_proof_balanced: "平衡：資產 ＝ 負債 ＋ 股東權益",
  balance_proof_imbalanced: "試算不平衡：資產 ≠ 負債 ＋ 股東權益",
  accounting_period: "會計期間",
  currency_label: "幣別",

  row_revenue: "主營業務收入",
  row_cogs: "減：營業成本與直接交付費用",
  row_gross_profit: "毛利",
  row_opex: "減：管理及營運費用",
  row_ebitda: "息稅折舊攤銷前利潤",
  row_depreciation: "減：折舊及攤銷",
  row_pbt: "稅前利潤",
  row_tax: "減：所得稅費用",
  row_net_profit: "本期淨利",
  row_current_assets: "流動資產",
  row_cash: "銀行存款與現金",
  row_ar: "應收賬款淨額",
  row_prepayments: "預付款項及留抵進項稅額",
  row_total_current_assets: "流動資產合計",
  row_non_current_assets: "非流動資產",
  row_fixed_assets_net: "固定資產與設備淨額",
  row_total_assets: "資產總計",
  row_current_liabilities: "流動負債",
  row_ap: "應付賬款與應計費用",
  row_tax_payable: "應交稅金",
  row_director_loan: "其他應付款（董事/股東往來款）",
  row_total_liabilities: "負債合計",
  row_equity: "股東權益",
  row_share_capital: "股本 / 資本公積",
  row_retained_earnings: "保留盈餘（含本期淨利）",
  row_total_equity: "股東權益合計",
  row_total_liabilities_equity: "負債與股東權益總計",
  row_cfs_op: "營業活動現金流量淨額",
  row_cfs_inv: "投資活動現金流量淨額",
  row_cfs_fin: "籌資活動現金流量淨額",
  row_cfs_net_change: "現金及約當現金淨增加額",
  row_cfs_open_cash: "加：期初現金餘額",
  row_cfs_close_cash: "期末現金及約當現金餘額",
  row_cfs_addback_dep: "加：折舊及攤銷",
  row_cfs_chg_ar: "應收賬款變動",
  row_cfs_chg_prepay: "預付款項及留抵稅額變動",
  row_cfs_chg_ap: "應付賬款及應計費用變動",
  row_cfs_chg_tax: "應交稅費變動",
  row_cfs_direct_in: "銷售商品、提供勞務收到的現金",
  row_cfs_direct_out: "購買商品、接受勞務及營運支付的現金",
  row_cfs_direct_tax: "支付的各項稅費",
  row_cfs_capex: "購建固定資產支付的現金",
  row_cfs_fin_equity: "吸收投資或分配股利",
  row_cfs_fin_loan: "股東/業主往來資金變動",

  tb_detail_title: "擴展試算表",
  tb_detail_subtitle: "全科目發生額、期末調整分錄與報表結轉自動勾稽表",
  col_acc_code: "科目代碼",
  col_acc_name: "科目名稱",
  col_open_bal: "期初餘額",
  col_period_activity: "本期發生額",
  col_aje: "調整分錄 (AJE)",
  col_ending_tb: "期末試算表",
  col_pnl: "損益表結轉",
  col_bs: "資產負債表結轉",
  dr_label: "借方",
  cr_label: "貸方",
  total_label: "借貸合計",
  balanced: "借貸試算平衡",
  imbalanced: "借貸不平",
  dest_balance_sheet: "資產負債表 (B/S)",
  dest_income_statement: "損益表 (P&L)",

  journal_title: "日記賬與憑證審核",
  journal_subtitle: "會計憑證流水、公私費用分攤與製單覆核權責分離",
  btn_split_expense: "記一筆公私費用分攤",
  btn_add_aje: "提列調整分錄 (AJE)",
  filter_all: "全部憑證",
  filter_pending: "待覆核",
  filter_posted: "已過賬",
  filter_rejected: "已駁回",
  col_voucher_no: "憑證編號",
  col_date: "記賬日期",
  col_description: "業務摘要",
  col_total_dr: "借方合計",
  col_total_cr: "貸方合計",
  col_hash: "防偽指紋",
  col_status: "狀態",
  col_actions: "操作",
  btn_review: "審核憑證",
  btn_approve: "核准並過賬",
  btn_reject: "駁回憑證",
  reject_reason_prompt: "請填寫駁回原因：",
  reject_reason_placeholder: "例：業務事由不明確，請補齊發票與商用比例證明",
  confirm_reject: "確認駁回",
  cancel: "取消",
  no_journals: "無符合條件之日記賬記錄",

  wp_title: "審計工作索引",
  wp_subtitle: "總賬與明細賬勾稽核對表",
  wp_drawer_title: "核驗詳情",
  wp_variance: "勾稽差額",
  wp_status_tied: "賬實相符",
  wp_status_not_performed: "待核對外部對賬單",
  wp_note: "核算標記說明",
  wp_evidence_hash: "原始指紋",
  wp_gl_balance: "總賬餘額",
  wp_subledger_balance: "明細賬餘額",
  wp_prepared_by: "編制人",
  wp_reviewed_by: "覆核人",
  wp_view_detail: "查看審計明細",
  wp_balanced_status: "勾稽相符 (0.00)",
  wp_items_title: "明細抽核清單",
  wp_col_desc: "項目說明",
  wp_col_amount: "金額",
  wp_col_notes: "備註 / 證明索引",
  wp_notes_title: "審計附註與核驗說明",
  wp_variance_tied: "勾稽差額：0.00（賬實相符）",
  wp_not_performed: "未執行（未取得外部核對來源）",

  close_title: "月末結賬與稅務申報",
  close_subtitle: "期末檢核清單、公私賬分離審核與會計師簽核封存",
  close_checklist: "結賬核驗程序清單",
  cpa_sign_btn: "會計師簽核封存",
  cpa_confirm_modal_title: "確認進行期末簽核封存？",
  cpa_confirm_modal_desc: "封存後當期會計賬目將鎖定為唯讀狀態，不可再直接追加分錄或調整憑證。",
  cpa_confirm_btn: "確認封存",

  db_view_title: "賬套與資料庫設置",
  db_view_subtitle: "企業賬套持久化存儲、連線狀態與備份快照",
  card_engine: "資料庫引擎",
  card_path: "連線資訊 / 存儲路徑",
  card_size: "賬套資料大小",
  card_status: "存儲狀態",
  backup_now: "立即備份賬套",
  backup_in_progress: "正在備份...",
  backup_snapshot_title: "建立即時賬套快照備份",
  backup_snapshot_desc: "生成當前賬套的獨立唯讀複本，用於稅務審計歸檔或災難備份。",
};

const en: Translations = {
  nav_statements: "Financial Statements",
  nav_etb: "Trial balance",
  nav_journals: "Journals & Ledger",
  nav_schedules: "Schedules",
  nav_close_tax: "Month-End Close & Tax",
  nav_database: "Database & Settings",

  app_title: "Agentic Accounting",
  current_period: "Period",
  db_connected: "Database Online",
  status_awaiting_cpa: "Pending CPA Review",
  status_locked: "CPA Signed & Locked",
  backup_btn: "Backup",
  copy_path: "Copy Path",
  copied: "Copied",
  print_report: "Print Report",

  tab_pnl: "Income Statement",
  tab_bs: "Balance Sheet",
  tab_cfs: "Cash Flow",
  pnl_title: "Income Statement",
  bs_title: "Balance Sheet",
  cfs_title: "Statement of Cash Flows",
  statement_ref_col: "Ref",
  account_name_col: "Financial Line Item",
  amount_col: "Amount",
  ratio_col: "%",
  balance_proof_balanced: "Balanced: Assets = Liabilities + Equity",
  balance_proof_imbalanced: "Out of Balance: Assets ≠ Liabilities + Equity",
  accounting_period: "Period",
  currency_label: "Currency",

  row_revenue: "Revenue / Turnover",
  row_cogs: "Less: Cost of Goods Sold & Direct Delivery",
  row_gross_profit: "Gross Profit",
  row_opex: "Less: Operating & Administrative Expenses",
  row_ebitda: "EBITDA",
  row_depreciation: "Less: Depreciation & Amortization",
  row_pbt: "Profit Before Tax (EBT)",
  row_tax: "Less: Income Tax Provision",
  row_net_profit: "Net Profit for the Period",
  row_current_assets: "Current Assets",
  row_cash: "Cash & Cash Equivalents",
  row_ar: "Accounts Receivable, Net",
  row_prepayments: "Prepayments & Recoverable Tax",
  row_total_current_assets: "Total Current Assets",
  row_non_current_assets: "Non-Current Assets",
  row_fixed_assets_net: "Property, Plant & Equipment, Net",
  row_total_assets: "Total Assets",
  row_current_liabilities: "Current Liabilities",
  row_ap: "Accounts Payable & Accrued Expenses",
  row_tax_payable: "Tax Payable",
  row_director_loan: "Director / Shareholder Loan",
  row_total_liabilities: "Total Liabilities",
  row_equity: "Equity",
  row_share_capital: "Share Capital",
  row_retained_earnings: "Retained Earnings (incl. Net Profit)",
  row_total_equity: "Total Equity",
  row_total_liabilities_equity: "Total Liabilities & Equity",
  row_cfs_op: "Net Cash Flow from Operating Activities",
  row_cfs_inv: "Net Cash Flow from Investing Activities",
  row_cfs_fin: "Net Cash Flow from Financing Activities",
  row_cfs_net_change: "Net Increase / (Decrease) in Cash",
  row_cfs_open_cash: "Cash Balance at Beginning of Period",
  row_cfs_close_cash: "Cash Balance at End of Period",
  row_cfs_addback_dep: "Add back: Depreciation & Amortization",
  row_cfs_chg_ar: "Increase / Decrease in Accounts Receivable",
  row_cfs_chg_prepay: "Increase / Decrease in Prepayments & Input Tax",
  row_cfs_chg_ap: "Increase / Decrease in Payables & Accruals",
  row_cfs_chg_tax: "Increase / Decrease in Statutory Taxes Payable",
  row_cfs_direct_in: "Cash Received from Customers",
  row_cfs_direct_out: "Cash Paid to Suppliers & Employees",
  row_cfs_direct_tax: "Cash Paid for Taxes & Levies",
  row_cfs_capex: "Payments for Property, Plant & Equipment",
  row_cfs_fin_equity: "Capital Contributions / Dividends",
  row_cfs_fin_loan: "Net Director's Loan / Owner Drawings Movement",

  tb_detail_title: "Trial balance",
  tb_detail_subtitle: "10-Column Multi-Book Trial Balance with Adjusting Journal Entries",
  col_acc_code: "Account Code",
  col_acc_name: "Account Name",
  col_open_bal: "Opening Balance",
  col_period_activity: "Period Activity",
  col_aje: "Adjustments (AJE)",
  col_ending_tb: "Ending Trial Balance",
  col_pnl: "Income Statement",
  col_bs: "Balance Sheet",
  dr_label: "Debit",
  cr_label: "Credit",
  total_label: "Total",
  balanced: "Balanced",
  imbalanced: "Out of Balance",
  dest_balance_sheet: "Balance Sheet (B/S)",
  dest_income_statement: "Income Statement (P&L)",

  journal_title: "General Ledger & Journals",
  journal_subtitle: "Audit Trail, Expense Apportionment & Maker-Checker Verification",
  btn_split_expense: "+ Split Expense",
  btn_add_aje: "+ Post Adjusting Entry",
  filter_all: "All Entries",
  filter_pending: "Pending Review",
  filter_posted: "Posted",
  filter_rejected: "Rejected",
  col_voucher_no: "Journal ID",
  col_date: "Date",
  col_description: "Description",
  col_total_dr: "Total Dr",
  col_total_cr: "Total Cr",
  col_hash: "Audit Hash",
  col_status: "Status",
  col_actions: "Actions",
  btn_review: "Review",
  btn_approve: "Approve & Post",
  btn_reject: "Reject",
  reject_reason_prompt: "Enter Rejection Reason:",
  reject_reason_placeholder: "e.g. Unclear business justification; missing receipt",
  confirm_reject: "Confirm Rejection",
  cancel: "Cancel",
  no_journals: "No journal entries found matching criteria",

  wp_title: "Audit Statements Index",
  wp_subtitle: "Subledger to GL Reconciliation",
  wp_drawer_title: "Statement Verification Details",
  wp_variance: "Variance",
  wp_status_tied: "Reconciled to GL",
  wp_status_not_performed: "Pending External Bank Statement",
  wp_note: "Tickmark Explanation",
  wp_evidence_hash: "Evidence Hash",
  wp_gl_balance: "GL Balance",
  wp_subledger_balance: "Subledger Balance",
  wp_prepared_by: "Prepared by",
  wp_reviewed_by: "Reviewed by",
  wp_view_detail: "View Statement",
  wp_balanced_status: "Balanced (0.00)",
  wp_items_title: "Sub-schedule Line Items",
  wp_col_desc: "Item Description",
  wp_col_amount: "Amount",
  wp_col_notes: "Notes / Audit Ref",
  wp_notes_title: "Audit Notes & Methodology",
  wp_variance_tied: "Variance: 0.00 (Tied to GL)",
  wp_not_performed: "Not performed (no external source)",

  close_title: "Month-End Close & Tax Filing",
  close_subtitle: "Pre-Close Checklist, Statutory Schedules & CPA Pack Sign-Off",
  close_checklist: "Verification Checklist",
  cpa_sign_btn: "CPA Sign & Lock Pack",
  cpa_confirm_modal_title: "Confirm Period Sign-Off & Lock?",
  cpa_confirm_modal_desc: "Once locked, this accounting period becomes immutable. No further adjustments can be posted.",
  cpa_confirm_btn: "Sign & Lock Period",

  db_view_title: "Database & Company File Settings",
  db_view_subtitle: "Ledger Persistence, Database Engine & Snapshot Backups",
  card_engine: "Database Engine",
  card_path: "Connection String / Path",
  card_size: "Ledger Size",
  card_status: "Status",
  backup_now: "Create Backup Now",
  backup_in_progress: "Backing up...",
  backup_snapshot_title: "Create Snapshot Backup",
  backup_snapshot_desc: "Creates a verified atomic snapshot of the accounting database for compliance and archiving.",
};

export const DICTIONARIES: Record<Language, Translations> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en: en,
};

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType>({
  lang: "zh-CN",
  setLang: () => {},
  t: zhCN,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem("agentic_acc_lang") as Language;
    return saved && ["zh-CN", "zh-TW", "en"].includes(saved) ? saved : "zh-TW";
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem("agentic_acc_lang", newLang);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: DICTIONARIES[lang] }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => useContext(I18nContext);

/**
 * Three-way copy picker for micro-copy that lives next to the markup.
 *
 * The previous pattern was `lang === "en" ? "english" : "中文"`, which made
 * 繁體 silently fall back to Simplified text. Every language key is required,
 * so a missing translation is a compile error instead of a silent fallback.
 */
export function pick<T>(lang: Language, values: Record<Language, T>): T {
  return values[lang] ?? values["zh-CN"];
}

export const LanguageSwitcher: React.FC = () => {
  const { lang, setLang } = useI18n();

  return (
    <div style={{ display: "inline-flex", gap: "2px", backgroundColor: "var(--muted)", padding: "2px", borderRadius: "6px" }}>
      <button
        type="button"
        onClick={() => setLang("zh-CN")}
        style={{
          padding: "3px 8px",
          fontSize: "0.75rem",
          fontWeight: lang === "zh-CN" ? 600 : 400,
          backgroundColor: lang === "zh-CN" ? "var(--background)" : "transparent",
          color: lang === "zh-CN" ? "var(--foreground)" : "var(--muted-foreground)",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          boxShadow: lang === "zh-CN" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        }}
      >
        简体
      </button>
      <button
        type="button"
        onClick={() => setLang("zh-TW")}
        style={{
          padding: "3px 8px",
          fontSize: "0.75rem",
          fontWeight: lang === "zh-TW" ? 600 : 400,
          backgroundColor: lang === "zh-TW" ? "var(--background)" : "transparent",
          color: lang === "zh-TW" ? "var(--foreground)" : "var(--muted-foreground)",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          boxShadow: lang === "zh-TW" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        }}
      >
        繁體
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        style={{
          padding: "3px 8px",
          fontSize: "0.75rem",
          fontWeight: lang === "en" ? 600 : 400,
          backgroundColor: lang === "en" ? "var(--background)" : "transparent",
          color: lang === "en" ? "var(--foreground)" : "var(--muted-foreground)",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          boxShadow: lang === "en" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        }}
      >
        EN
      </button>
    </div>
  );
};

/* Label localisation lives in src/lib/labels.ts — `localizeLabel()`. */
