#!/usr/bin/env python3
"""Generate golden fixtures for backend-go from the frozen Python reference.

P0 demo module: money. The reference semantics are Python's decimal module
(standard library, default context: 28 significant digits, ROUND_HALF_EVEN) —
the exact arithmetic every one of the 345 decimal touchpoints in backend/app
uses. From P1 on, this script also imports the frozen backend modules that a
fixture module ports, so the reference is always the real implementation.

Run (from the repository root):
    cd backend && uv run python ../backend-go/tools/gen_fixtures.py

Output: backend-go/fixtures/<module>/*.json — deterministic, sorted keys,
compact separators. Money values cross as strings; floats never appear.

Known defects (SRC-0026 findings) are NOT exercised here: they are excluded
from the golden baseline by design (ADR-0002 D3) and registered as expected
divergences in fixtures/divergences.yaml, never as fixtures.
"""

from __future__ import annotations

import json
from decimal import (
    ROUND_CEILING,
    ROUND_DOWN,
    ROUND_FLOOR,
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    ROUND_UP,
    Decimal,
    InvalidOperation,
)
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "backend-go" / "fixtures"

MODES = {
    "half_even": ROUND_HALF_EVEN,
    "half_up": ROUND_HALF_UP,
    "down": ROUND_DOWN,
    "up": ROUND_UP,
    "ceiling": ROUND_CEILING,
    "floor": ROUND_FLOOR,
}


def write(module: str, name: str, case_input: dict, output=None, error: str | None = None) -> None:
    """Write one fixture case file. output xor expected_error is present."""
    doc = {"module": module, "case": name, "input": case_input}
    if error is not None:
        doc["expected_error"] = error
    else:
        doc["output"] = output
    path = OUT / module / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def gen_money_parse() -> int:
    """Parse/String parity: output must equal str(Decimal(a)) byte for byte.

    The non-finite specials ("Infinity", "NaN") are excluded on purpose: the
    Go money grammar rejects them by documented scope, and no money path in
    the frozen backend produces them.
    """
    inputs = [
        "0", "-0", "0.00", "-0.00", "0E+2", "-0E-2",
        "1", "1.5", "1.500", "-1.500", "100", "+0.5",
        "0.000001", "0.0000001", "-0.000001",
        "1E+2", "1e2", "1.5E-3", "1.5e2", "1E+999999", "1E-999999",
        # Exponents beyond the reference context's Emax/Emin are a documented
        # grammar-scope exclusion (Python constructs them but its arithmetic
        # traps; Go rejects at parse) — not fixture-eligible, like specials.
        "1.", ".5", "001.500", "1_000.50", "  12.5  ",
        # Underscores are free-floating separators in libmpdec (laxer than
        # PEP 515); the accepted/rejected edges are pinned here.
        "1_", "_1", "1__0", "-_1", "_.5", "1.5_", ".5_", "1_e2", "1e1_0",
        "1_e+2", "_1.5", "1._5", "1_.e2", "__1",
        "999999999999.9997", "-999999999999.9997",
        "12345678901234567890.123456789",
        # Rejected forms (Python raises InvalidOperation on construction):
        "", "abc", "12,5", "1.2.3", "1e", "--1", "e5", ".",
        "- 1", "1 e2", "1..2", "+-1", "0x10", "._", "_ _", "1_+", "1.5.5_",
    ]
    count = 0
    for i, s in enumerate(inputs):
        name = f"parse_{i:02d}"
        try:
            d = Decimal(s)
        except InvalidOperation:
            write("money", name, {"op": "string", "a": s}, error="invalid_parse")
        else:
            write("money", name, {"op": "string", "a": s}, output=str(d))
        count += 1
    return count


def gen_money_add() -> int:
    """Add parity under the reference context, including zero-sign rules,
    the zero-operand exponent rules and the 28-significant-digit cap."""
    pairs = [
        ("1.50", "0.255"),
        ("0.00", "0.00"),
        ("0.00", "0"),
        ("-0", "-0"),
        ("-0", "0"),
        ("-5", "5"),
        ("1E+2", "1E+2"),
        # Zero-operand exponent rules: the ideal exponent (the smaller one)
        # always wins, zero operand or not.
        ("0", "1E+2"),
        ("0.00", "1.5"),
        ("0", "1.500"),
        ("0E+5", "1E+2"),
        ("0E+2", "1E+5"),
        ("-0", "1E+2"),
        ("0E+2", "1.5"),
        ("999999999999.9997", "0.0003"),
        ("9999999999999999999999999999", "1"),
        ("99999999999999999999999999999999", "99999999999999999999999999999998"),
        ("-1.500", "1.500"),
        ("1.5e2", "1.5"),
        ("-1", "-1"),
        ("1E-7", "1E-7"),
        ("0.1", "0.2"),
        ("-1.5E-3", "0.0015"),
    ]
    count = 0
    for i, (a, b) in enumerate(pairs):
        name = f"add_{i:02d}"
        da, db = Decimal(a), Decimal(b)
        write("money", name, {"op": "add", "a": a, "b": b}, output=str(da + db))
        count += 1
    return count


def gen_money_mul() -> int:
    """Mul parity under the reference context: exact coefficient product at
    the summed exponent, 28-significant-digit half-even cap, Python's
    zero-sign rules for products."""
    pairs = [
        ("1.500", "0.13"),
        ("1000.0000", "0.13"),
        ("999999999999999999999999.9999", "0.13"),  # 28-digit carry case
        ("9999999999999999999999999999", "9.99"),   # cap applies
        ("-0", "5"),
        ("-0", "-5"),
        ("0", "0"),
        ("1.5e2", "1E-7"),
        ("-1.5", "-2"),
        ("0.0000001", "0.0000001"),
    ]
    count = 0
    for i, (a, b) in enumerate(pairs):
        name = f"mul_{i:02d}"
        da, db = Decimal(a), Decimal(b)
        write("money", name, {"op": "mul", "a": a, "b": b}, output=str(da * db))
        count += 1
    return count


def gen_money_div() -> int:
    """Div parity (Python Decimal division under the reference context):
    exact quotients keep the ideal exponent within precision, inexact
    quotients round to 28 significant digits half-even on the true
    remainder, 0/0 is InvalidOperation and nonzero/0 is DivisionByZero."""
    cases = [
        ("1200.0000", "12"),   # exact, ideal exponent kept: 100.0000
        ("100", "4"),          # exact, ideal exponent reachable: 25
        ("1E+2", "4"),         # exact, ideal exponent unreachable: 25
        ("10", "4"),           # exact, fractional: 2.5
        ("2.5", "0.5"),        # exact at the ideal exponent: 5
        ("1.5e2", "3"),        # exact: 5E+1
        ("0.000", "5"),        # zero keeps the ideal exponent: 0.000
        ("-0", "5"),           # zero sign XOR: -0
        ("1", "3"),            # inexact, rounds down
        ("2", "3"),            # inexact, rounds up
        ("100", "7"),          # inexact, true remainder decides (rounds up)
        ("9999999999999999999999999999", "3"),  # exact at precision
        ("1.0000000000000000000000000001", "1"),  # inexact 29-digit dividend
        ("-6", "4"),
        ("6", "-4"),
        # The exact/inexact boundary: the scaled division is exact but the
        # 28-digit rounding dropped digits, so the result keeps its computed
        # form (Python-review differential case):
        ("6175295107414627927607.344389", "0.003750"),
        # Context bounds at the parse-legal exponent extremes:
        ("1E-999999", "1E+999999"),   # zero quotient clamps to the subnormal floor
        ("0E+999999", "1E-999999"),   # zero upper clamp at Emax
        ("1E+999999", "1E+999998"),   # exact at the ideal exponent
        ("1E+999999", "1E+999980"),
        ("1E+999999", "1E-999999"),   # Overflow trap
        ("1E-999999", "1E+30"),       # silent underflow to zero
        ("1E-999999", "1E+21"),       # subnormal band kept: 1E-1000020
        ("1", "0"),            # DivisionByZero
        ("0", "0.0"),          # InvalidOperation (0/0)
    ]
    count = 0
    for i, (a, b) in enumerate(cases):
        name = f"div_{i:02d}"
        da, db = Decimal(a), Decimal(b)
        try:
            out = str(da / db)
        except ZeroDivisionError:
            write("money", name, {"op": "div", "a": a, "b": b}, error="division_by_zero")
        except InvalidOperation:
            write("money", name, {"op": "div", "a": a, "b": b}, error="divide_invalid")
        except ArithmeticError:
            # decimal.Overflow — the only other ArithmeticError division raises.
            write("money", name, {"op": "div", "a": a, "b": b}, error="overflow")
        else:
            write("money", name, {"op": "div", "a": a, "b": b}, output=out)
        count += 1
    return count


def gen_money_round() -> int:
    """Round parity (Python quantize with an explicit rounding mode),
    including zero-sign results and the precision-limit rejection."""
    cases = [
        ("2.675", 2, "half_up"),
        ("2.5", 0, "half_even"),
        ("3.5", 0, "half_even"),
        ("-2.5", 0, "half_even"),
        ("-0.5", 0, "half_even"),
        ("0.5", 0, "half_even"),
        ("1.005", 2, "down"),
        ("-1.005", 2, "up"),
        ("-0.4", 0, "half_up"),
        ("-0.4", 0, "half_even"),
        ("-0.4", 0, "down"),
        ("-0.4", 0, "up"),
        ("-0.4", 0, "ceiling"),
        ("-0.4", 0, "floor"),
        ("0.4", 0, "floor"),
        ("0.4", 0, "ceiling"),
        ("-0.001", 2, "half_up"),
        ("-0.001", 2, "ceiling"),
        ("-0.001", 2, "floor"),
        ("1E+2", 0, "half_even"),
        ("1.5E-3", 6, "half_even"),
        # Zero quantizes to any representable exponent (Python zero rule):
        ("0", 1000000, "half_even"),
        ("0", -2, "half_even"),
        # Negative places: fewer significant digits, rounding applies:
        ("123", -2, "half_even"),
        ("125", -2, "half_even"),   # tie -> half-even -> 1E+2 (2 is even)
        # Boundary rejections (both sides raise):
        ("1.5", 999999, "half_even"),   # result would need 1e6 digits
        ("1.5", 3000000, "half_even"),  # scaleb operand trap
        ("12345678901234567890123456789", 0, "half_even"),  # 29 digits -> InvalidOperation
        ("1E+30", 0, "half_even"),  # 31 digits after expansion -> InvalidOperation
    ]
    count = 0
    for i, (v, places, mode) in enumerate(cases):
        name = f"round_{i:02d}"
        try:
            exp = Decimal(1).scaleb(-places)  # traps beyond the scaleb limit
            d = Decimal(v).quantize(exp, rounding=MODES[mode])
        except InvalidOperation:
            write("money", name, {"op": "round", "a": v, "places": places, "mode": mode},
                  error="invalid_quantize")
        else:
            write("money", name, {"op": "round", "a": v, "places": places, "mode": mode},
                  output=str(d))
        count += 1
    return count


def main() -> None:
    total = (
        gen_money_parse()
        + gen_money_add()
        + gen_money_mul()
        + gen_money_div()
        + gen_money_round()
    )
    print(f"generated {total} money fixtures under {OUT / 'money'}")


if __name__ == "__main__":
    main()
