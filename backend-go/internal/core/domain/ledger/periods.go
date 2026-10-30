package ledger

import (
	"sort"
)

// This file ports the fiscal-period state rules of backend/app/core/ledger.py:
// the fiscal_periods row projection (_period_dict), get_period's missing-row
// auto-create branch (ensure_period with the OPEN default), and
// assert_writable's overlap rule — a posting is refused when any non-writable
// period contains the actual accounting date; without a date the check
// conservatively rejects any lock overlapping the whole period span. The
// session plumbing (row locks, inserts, transaction joins) is store work.

// Period mirrors one fiscal_periods row (FiscalPeriodModel) as the pure rules
// read it. JSON tags are the keys of _period_dict; ClosedAt is the ISO string
// the reference renders from the stored datetime (or null).
type Period struct {
	PeriodID             string  `json:"period_id"`
	EntityCode           string  `json:"entity_code"`
	PeriodCode           string  `json:"period_code"`
	FiscalYear           int     `json:"fiscal_year"`
	PeriodNumber         int     `json:"period_number"`
	StartDate            string  `json:"start_date"`
	EndDate              string  `json:"end_date"`
	Status               string  `json:"status"`
	ClosedByPrincipalKey *string `json:"closed_by_principal_key"`
	ClosedAt             *string `json:"closed_at"`
}

// IsWritable mirrors _period_dict's is_writable: only OPEN and SOFT_CLOSE
// accept postings. FUTURE, HARD_CLOSE and LOCKED (the reference's other
// statuses) all refuse writes.
func (p Period) IsWritable() bool {
	return p.Status == "OPEN" || p.Status == "SOFT_CLOSE"
}

// PeriodView is _period_dict's projection: the row plus its derived
// writability.
type PeriodView struct {
	Period
	IsWritable bool `json:"is_writable"`
}

// ViewOf renders the reference's _period_dict for one row.
func ViewOf(p Period) PeriodView {
	return PeriodView{Period: p, IsWritable: p.IsWritable()}
}

// ResolvePeriod ports get_period plus ensure_period's auto-create branch: a
// missing period row behaves as a freshly created OPEN period with calendar
// bounds (status default "OPEN", no closer, no timestamp). The stored row is
// returned as-is when it exists — its status and dates are the books' state,
// not re-derived from the code. The insert itself is store work.
func ResolvePeriod(entityCode, periodCode string, periods []Period) (Period, error) {
	span, err := PeriodBounds(periodCode)
	if err != nil {
		return Period{}, err
	}
	id := entityCode + ":" + periodCode
	for _, p := range periods {
		if p.PeriodID == id {
			return p, nil
		}
	}
	return Period{
		PeriodID:     id,
		EntityCode:   entityCode,
		PeriodCode:   periodCode,
		FiscalYear:   span.FiscalYear,
		PeriodNumber: span.PeriodNumber,
		StartDate:    span.Start,
		EndDate:      span.End,
		Status:       "OPEN",
	}, nil
}

// AssertWritable ports assert_writable's pure content. With an accounting
// date, the date is validated against the period first (INVALID_ACCOUNTING_DATE
// and PERIOD_DATE_MISMATCH propagate) and narrowed to that single day; the
// check then refuses when any non-writable period of the entity overlaps the
// window — a locked month blocks a posting through an open quarter label, a
// month open inside a locked quarter refuses, and an open October date stays
// writable when only November is locked even under a Q4 label. Without a
// date, the whole period span is checked conservatively. The first blocking
// row in period-code order names the refusal, as the reference's ordered
// query does.
func AssertWritable(entityCode, periodCode string, accountingDate *string, periods []Period) (Period, error) {
	span, err := PeriodBounds(periodCode)
	if err != nil {
		return Period{}, err
	}
	start, end := span.Start, span.End
	if accountingDate != nil {
		if _, err := ValidatePostingDate(*accountingDate, &periodCode); err != nil {
			return Period{}, err
		}
		start, end = *accountingDate, *accountingDate
	}
	period, err := ResolvePeriod(entityCode, periodCode, periods)
	if err != nil {
		return Period{}, err
	}
	blocked, found := firstOverlappingLock(periods, start, end)
	if found {
		msg := "PERIOD_LOCKED: 期間 " + blocked.PeriodCode + " 狀態為 " + blocked.Status
		if blocked.ClosedAt != nil {
			msg += "，由 " + deref(blocked.ClosedByPrincipalKey) + " 於 " + *blocked.ClosedAt + " 封存。"
		} else {
			msg += "。"
		}
		msg += " 已封存的期間不可再寫入分錄。"
		return Period{}, fail(ErrPeriodLocked, msg)
	}
	return period, nil
}

// firstOverlappingLock mirrors the reference's ordered query: the first row
// (by period code) that is not writable and whose [start_date, end_date]
// overlaps [start, end], all comparisons inclusive on date strings.
func firstOverlappingLock(periods []Period, start, end string) (Period, bool) {
	sorted := make([]Period, len(periods))
	copy(sorted, periods)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].PeriodCode < sorted[j].PeriodCode })
	for _, p := range sorted {
		if p.IsWritable() {
			continue
		}
		if p.StartDate <= end && p.EndDate >= start {
			return p, true
		}
	}
	return Period{}, false
}

// deref renders an optional string the way the reference's f-strings render
// None: as "None".
func deref(s *string) string {
	if s == nil {
		return "None"
	}
	return *s
}
