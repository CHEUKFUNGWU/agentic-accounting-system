package pgx

import (
	"context"
	"fmt"

	"github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go/internal/core/store/storetest"
)

// The storetest.SuiteHooks implementation (see that package's doc): test-only
// capabilities the behavioral suite needs. None of these are on the Store
// interface; production code never calls them.

// SeedEntity inserts the bootstrap rows the reference's
// init_seed_data_if_needed seeds: one entity and a two-account chart.
func (s *Store) SeedEntity(ctx context.Context, entityCode string) error {
	ts, err := toTS(storetest.SuiteAt)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO entities (entity_code, legal_name,
		entity_structure, jurisdiction, currency, accounting_standard, tax_id,
		reporting_status, created_at) VALUES ($1, 'Suite Entity Ltd', 'OPC_LIMITED',
		'AU', 'AUD', 'AASB_TIER2', '51824753556', 'READY', $2)`, entityCode, ts); err != nil {
		return fmt.Errorf("pgx: seed entity: %w", err)
	}
	accounts := []struct{ code, name, typ, balance, fs, activity string }{
		{"1110", "Cash", "ASSET", "DEBIT", "CASH", "CASH_EQUIV"},
		{"4100", "Revenue", "REVENUE", "CREDIT", "REVENUE", "OPERATING_WC"},
	}
	for _, a := range accounts {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO chart_of_accounts (account_id,
			entity_code, account_code, account_name, account_type, normal_balance,
			fs_category, default_statement_ref, cash_flow_activity, is_control_account,
			allow_manual_je, is_active, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'TB', $8, false, true, true, $9)`,
			entityCode+":"+a.code, entityCode, a.code, a.name, a.typ, a.balance,
			a.fs, a.activity, ts); err != nil {
			return fmt.Errorf("pgx: seed account: %w", err)
		}
	}
	return nil
}

// SeedLockedPeriod inserts one LOCKED fiscal period (BL-04's refusal state).
func (s *Store) SeedLockedPeriod(ctx context.Context, entityCode, periodCode string) error {
	ts, err := toTS(storetest.SuiteAt)
	if err != nil {
		return err
	}
	span := periodCode + "-01"
	if _, err := s.db.ExecContext(ctx, `INSERT INTO fiscal_periods (period_id,
		entity_code, period_code, fiscal_year, period_number, start_date, end_date,
		status, created_at) VALUES ($1, $2, $3, 2026, 9, $4, $5, 'LOCKED', $6)`,
		entityCode+":"+periodCode, entityCode, periodCode, span, span[:8]+"30", ts); err != nil {
		return fmt.Errorf("pgx: seed period: %w", err)
	}
	return nil
}

// EvidenceRoot exposes the evidence directory for the suite's file setup.
func (s *Store) EvidenceRoot() string { return s.evidenceDir }

// TamperChain corrupts one persisted chain field out-of-band, simulating an
// attacker with raw database access. Test-only: no caller path reaches raw SQL.
func (s *Store) TamperChain(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE journal_entries
		SET total_debit = '101.0000' WHERE entry_hash IS NOT NULL`); err != nil {
		return fmt.Errorf("pgx: tamper: %w", err)
	}
	return nil
}
