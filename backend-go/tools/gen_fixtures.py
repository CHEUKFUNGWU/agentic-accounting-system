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
    Decimal,
    InvalidOperation,
    ROUND_CEILING,
    ROUND_DOWN,
    ROUND_FLOOR,
    ROUND_HALF_EVEN,
    ROUND_HALF_UP,
    ROUND_UP,
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
        "1E+2", "1e2", "1.5E-3", "1.5e2", "1E+999999",
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
        ("12345678901234567890123456789", 0, "half_even"),  # 29 digits -> InvalidOperation
        ("1E+30", 0, "half_even"),  # 31 digits after expansion -> InvalidOperation
    ]
    count = 0
    for i, (v, places, mode) in enumerate(cases):
        name = f"round_{i:02d}"
        exp = Decimal(1).scaleb(-places)
        try:
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
    total = gen_money_parse() + gen_money_add() + gen_money_round()
    print(f"generated {total} money fixtures under {OUT / 'money'}")


if __name__ == "__main__":
    main()
