/* Client for the voucher (記賬憑證) endpoints added to the backend. */

const API = "http://localhost:8000/api/v1";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // FastAPI puts the refusal reason in `detail`; surface it verbatim — the
    // refusal message IS the product feature.
    throw new Error(payload?.detail ?? `HTTP ${res.status}`);
  }
  return payload as T;
}

export interface Principal {
  principal_key: string;
  principal_id: string;
  agent_name: string;
  role: string;
  position?: string | null;
  is_human?: boolean;
  can_create: boolean;
  can_approve: boolean;
  max_auto_approve_func_amount: string;
  min_confidence_threshold: string;
}

export interface Account {
  account_code: string;
  account_name: string;
  account_type: string;
  fs_category: string;
  statement_ref: string;
  normal_balance: "DEBIT" | "CREDIT";
  is_control_account: boolean;
  is_active: boolean;
}

export interface VoucherLine {
  line_number: number;
  account_code: string;
  account_name?: string;
  debit: string;
  credit: string;
  memo: string;
  counterparty: string;
  tax_code: string;
  business_use_pct: string;
}

export interface VoucherSummary {
  journal_id: string;
  voucher_no: string;
  entity_code: string;
  period: string;
  accounting_date: string;
  currency: string;
  status: "DRAFT" | "PENDING_CHECKER" | "AWAITING_CPA" | "POSTED" | "REJECTED" | "REVERSED";
  source_module: string;
  memo: string;
  total_debit: string;
  total_credit: string;
  line_count: number;
  attachment_count: number;
  created_by_principal_key: string;
  approved_by_principal_key?: string | null;
  submitted_at?: string | null;
  posted_at?: string | null;
  reject_reason?: string | null;
  entry_hash?: string | null;
  prev_entry_hash?: string | null;
  block_index?: number;
  reversal_of_journal_id?: string | null;
  ai_confidence_score?: string;
  ai_reasoning_summary?: string;
}

export interface EvidenceRecord {
  kind: string;
  name: string;
  stored_name: string;
  mime: string;
  size: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface VoucherDetail extends VoucherSummary {
  lines: VoucherLine[];
  evidence_uris: EvidenceRecord[];
  created_by_agent_name?: string;
  approved_by_agent_name?: string | null;
}

export interface LedgerMovement {
  date: string;
  voucher_no: string;
  journal_id: string;
  memo: string;
  counterparty: string;
  debit: string;
  credit: string;
  balance: string;
  balance_side: "DEBIT" | "CREDIT";
  entry_hash?: string | null;
}

export interface AccountLedger {
  account: Account;
  opening_balance: string;
  opening_side: "DEBIT" | "CREDIT";
  total_debit: string;
  total_credit: string;
  closing_balance: string;
  closing_side: "DEBIT" | "CREDIT";
  movements: LedgerMovement[];
}

export interface ChartAccount {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normal_balance: "DEBIT" | "CREDIT";
  fs_category: string;
  statement_ref: string;
  cash_flow_activity: string;
  is_control_account: boolean;
  allow_manual_je: boolean;
  tax_code_default?: string | null;
  is_active: boolean;
  parent_account_id?: string | null;
}

export interface FiscalPeriod {
  period_id: string;
  period_code: string;
  fiscal_year: number;
  period_number: number;
  start_date: string;
  end_date: string;
  status: "FUTURE" | "OPEN" | "SOFT_CLOSE" | "HARD_CLOSE" | "LOCKED";
  closed_by_principal_key?: string | null;
  closed_at?: string | null;
  is_writable: boolean;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  fs_category: string;
  statement_ref: string;
  normal_balance: "DEBIT" | "CREDIT";
  opening: string;
  opening_side: string;
  period_debit: string;
  period_credit: string;
  adjustment_debit: string;
  adjustment_credit: string;
  closing: string;
  closing_side: string;
  display_balance: string;
}

export interface BalanceProof {
  ledger_balanced: boolean;
  ledger_debit: string;
  ledger_credit: string;
  ledger_difference: string;
  period_balanced: boolean;
  period_debit: string;
  period_credit: string;
  period_difference: string;
}

export interface CloseResult {
  period_code: string;
  status: string;
  closed_by_principal_key: string;
  next_period: string;
  trial_balance: BalanceProof;
  carried_forward: Array<{ account_code: string; opening: string }>;
  carried_forward_total: string;
}

export interface DocumentRecord {
  document_id: string;
  entity_code: string;
  doc_type: string;
  doc_date: string;
  counterparty_id?: string | null;
  counterparty_name: string;
  amount: string;
  currency: string;
  status: "NEW" | "POSTED" | "VOID";
  journal_id?: string | null;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  sha256: string;
  note: string;
  created_at?: string | null;
  posted_at?: string | null;
}

export interface TaxCode {
  tax_code: string;
  description: string;
  tax_mechanism: string;
  rate: string;
  recoverable_pct: string;
  statutory_return_box: string;
  tax_account_code?: string | null;
}

export interface Counterparty {
  counterparty_id: string;
  legal_name: string;
  counterparty_type: string;
  country_code: string;
  tax_id_number: string;
  withholding_rule: string;
}

export interface CashFlowBreakdown {
  entity_code: string;
  period: string;
  currency: string;
  opening: string;
  closing: string;
  movement: string;
  derived_movement: string;
  ties: boolean;
  inflows: Array<{ fs_category: string; account_type: string; amount: string }>;
  outflows: Array<{ fs_category: string; account_type: string; amount: string }>;
}

export const bookApi = {
  principals: () => req<{ principals: Principal[] }>("/principals"),
  chart: (entity: string, includeInactive = false) =>
    req<{ accounts: ChartAccount[] }>(
      `/entities/${entity}/chart-of-accounts?include_inactive=${includeInactive}`,
    ),
  saveAccount: (entity: string, code: string, body: Partial<ChartAccount>) =>
    req<{ account: ChartAccount }>(`/entities/${entity}/chart-of-accounts/${code}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  periods: (entity: string) => req<{ periods: FiscalPeriod[] }>(`/entities/${entity}/periods`),
  taxCodes: (entity: string) => req<{ tax_codes: TaxCode[] }>(`/entities/${entity}/tax-codes`),
  counterparties: (entity: string) =>
    req<{ counterparties: Counterparty[] }>(`/entities/${entity}/counterparties`),
  closePeriod: (entity: string, period: string, principalKey: string) =>
    req<CloseResult>(`/entities/${entity}/periods/${period}/close`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principalKey, period }),
    }),
  cashFlow: (entity: string, period: string) =>
    req<CashFlowBreakdown>(`/ledger/cash-flow-breakdown?entity_code=${entity}&period=${period}`),
  trialBalance: (entity: string, period: string) =>
    req<{ entity_code: string; period: string; rows: TrialBalanceRow[]; proof: BalanceProof }>(
      `/ledger/trial-balance?entity_code=${entity}&period=${period}`,
    ),
  documents: (entity: string) =>
    req<{ documents: DocumentRecord[]; counts: Record<string, number> }>(
      `/documents?entity_code=${entity}`,
    ),
  documentUrl: (documentId: string) => `${API}/documents/${documentId}/file`,
  uploadDocument: async (
    entity: string,
    file: File,
    fields: { doc_type: string; doc_date: string; counterparty_name: string; amount: string; uploaded_by: string },
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity_code", entity);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${API}/documents`, { method: "POST", body: form });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.detail ?? `HTTP ${res.status}`);
    return payload as { document: DocumentRecord };
  },
  documentToVoucher: (
    documentId: string,
    body: { principal_key: string; debit_account_code: string; credit_account_code: string },
  ) =>
    req<{ journal_id: string; voucher_no: string; status: string }>(`/documents/${documentId}/to-voucher`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  voidVoucher: (id: string, principalKey: string, reason: string) =>
    req<{ voucher: VoucherDetail }>(`/vouchers/${id}/void`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principalKey, reason }),
    }),
  vouchers: (entity: string, period?: string) =>
    req<{ vouchers: VoucherSummary[]; counts: Record<string, number> }>(
      `/vouchers?entity_code=${entity}${period ? `&period=${period}` : ""}`,
    ),
  voucher: (id: string) => req<{ voucher: VoucherDetail }>(`/vouchers/${id}`),
  create: (body: unknown) => req<{ voucher: VoucherDetail }>("/vouchers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    req<{ voucher: VoucherDetail }>(`/vouchers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  submit: (id: string, principal: string) =>
    req<{ voucher: VoucherDetail }>(`/vouchers/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principal }),
    }),
  approve: (id: string, principal: string) =>
    req<{ voucher: VoucherDetail; entry_status: string }>(`/vouchers/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principal }),
    }),
  reject: (id: string, principal: string, reason: string) =>
    req<{ voucher: VoucherDetail }>(`/vouchers/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principal, reason }),
    }),
  reverse: (id: string, principal: string) =>
    req<{ voucher: VoucherDetail }>(`/vouchers/${id}/reverse`, {
      method: "POST",
      body: JSON.stringify({ principal_key: principal }),
    }),
  upload: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/vouchers/${id}/attachments`, { method: "POST", body: form });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.detail ?? `HTTP ${res.status}`);
    return payload as { attachment: EvidenceRecord; attachment_count: number };
  },
  detach: (id: string, storedName: string) =>
    req<{ attachment_count: number }>(`/vouchers/${id}/attachments/${encodeURIComponent(storedName)}`, { method: "DELETE" }),
  accountLedger: (entity: string, code: string, period: string) =>
    req<AccountLedger>(`/ledger/accounts/${code}?entity_code=${entity}&period=${period}`),
  attachmentUrl: (entity: string, storedName: string) =>
    `${API}/attachments/${entity}/${encodeURIComponent(storedName)}`,
};
