"""Phase 1 of the QA review engine: mechanical, deterministic checks that
need no judgment calls -- completeness, file hygiene, and CSV-based time
coverage/balance math. See the project chat history for the full 9-check
spec this is the first slice of.

This module only reads bytes handed to it; it doesn't know about ZipFile,
UploadFile, or the rest of app.py, so it can be tested and reasoned about on
its own.
"""
import csv
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Optional

import fitz

try:
    import pytesseract
    from PIL import Image
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False

CONTROL_FILENAMES = {"manifest.json", "metadata.json", "review.json", "catalog.json"}
EXPECTED_EXTENSIONS = {".pdf", ".csv", ".xlsx", ".docx"}
SNAPSHOT_APPS = {"artifacts", "equifax_myequifax", "experian", "turbotax"}

DATE_COLUMN_NAMES = {"date", "datetime", "transaction date", "posting date", "post date"}
BALANCE_COLUMN_NAMES = {"balance", "running balance", "ending daily balance"}
AMOUNT_COLUMN_NAMES = {"amount", "amount (total)", "transaction amount"}
BEGIN_BALANCE_NAMES = {"beginning balance", "starting balance", "opening balance"}
END_BALANCE_NAMES = {"ending balance", "closing balance"}
DESCRIPTION_COLUMN_NAMES = {"description", "note", "notes", "memo", "merchant", "payee", "type"}
ACCOUNT_COLUMN_NAMES = {"account", "account number", "account id", "from", "to"}

_DATETIME_FORMATS = [
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d",
    "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y",
]

# Each entry is (regex, (year_group, month_group, day_group)); day_group may
# be None when only a month and year are encoded, in which case the day
# defaults to the 1st for sorting purposes. Patterns are tried in order
# from most specific (separators, exact day) to least specific (bare digit
# runs), since the first successful match wins.
#
# Split into SAFE (an unambiguous separator plus a full year) and UNSAFE
# (no separator at all, e.g. \d{4}\d{2}\d{2}) rather than one flat list
# sliced by a magic index: filenames rarely contain an unrelated 6-8 digit
# run, so the unsafe patterns are fine there, but real document prose is
# full of account/routing numbers an unseparated digit run can accidentally
# match -- body text only ever searches the safe half.
DATE_PATTERNS_SAFE = [
    (re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})_(\d{1,2})_(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})\.(\d{1,2})\.(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})/(\d{1,2})/(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})_(\d{1,2})_(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)"), (3, 1, 2)),
    # 2-digit-year variants of the same MM-DD-YYYY shape. Mortgage/loan
    # statements commonly print "Statement Date 06/02/26" -- still an
    # unambiguous 3-part, separator-delimited date, so it's just as safe
    # for body text as the 4-digit-year forms above; only the year needs
    # expanding (see _expand_year, applied uniformly in _try_numeric_patterns).
    (re.compile(r"(?<!\d)(\d{1,2})-(\d{1,2})-(\d{2})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})_(\d{1,2})_(\d{2})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{2})(?!\d)"), (3, 1, 2)),
]
DATE_PATTERNS_UNSAFE = [
    # Auto-generated filenames like "Billing20260907100228.pdf" encode a
    # full YYYYMMDDHHMMSS timestamp (14 digits) rather than a bare
    # YYYYMMDD (8 digits) -- tried first since it's more specific than the
    # 8-digit pattern below, which the trailing digit-boundary lookahead
    # would otherwise reject outright for this 14-digit run.
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})\d{6}(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{4})-(\d{1,2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{4})_(\d{1,2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{1,2})-(\d{4})(?!\d)"), (2, 1, None)),
    (re.compile(r"(?<!\d)(\d{1,2})_(\d{4})(?!\d)"), (2, 1, None)),
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{2})(\d{4})(?!\d)"), (2, 1, None)),
]
DATE_PATTERNS = DATE_PATTERNS_SAFE + DATE_PATTERNS_UNSAFE
BODY_TEXT_DATE_PATTERNS = DATE_PATTERNS_SAFE

MONTH_NAMES = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MONTH_NAME_RE = "|".join(sorted(MONTH_NAMES, key=len, reverse=True))
# Split into two patterns rather than one with an optional day group: with
# an optional day, "April 30.pdf" (a real filename with no year at all)
# would fail to match "30" as a day (no separator+digits follow it before
# ".pdf"), backtrack, and match the bare "30" as a 2-digit YEAR instead --
# silently producing April 2030. Requiring a day to be followed by an
# actual separator+year, and requiring a *4-digit* year when there's no
# day at all, closes that hole: a bare "Month DD" with nothing else now
# correctly finds no date instead of fabricating a wrong one.
#
# A *second* instance of the same ambiguity shows up in real statement
# prose: "April 1 - April 30, 2026" (a period range) lets "30" -- the
# range's own end day -- get misread as a 2-digit year off the second
# "April". Filenames are short, deliberate strings where a 2-digit year is
# a normal, low-risk convention; free-flowing document text is full of
# unrelated numbers (ranges, amounts, phone numbers), so for body text the
# "_STRICT" variants below require a full 4-digit year everywhere, never a
# bare 2-digit one, trading a little recall for not fabricating wrong dates.
def _month_day_year_pattern(year_digits: str) -> re.Pattern:
    return re.compile(r"(?i)(?<![A-Za-z])(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]*(\d{1,2})[ _.\-,]+(\d{" + year_digits + r"})(?!\d)")


def _day_first_pattern(year_digits: str) -> re.Pattern:
    return re.compile(r"(?i)(?<!\d)(\d{1,2})[ _.\-]*(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]*(\d{" + year_digits + r"})(?!\d)")


MONTH_DAY_YEAR_PATTERN = _month_day_year_pattern("2,4")
MONTH_DAY_YEAR_PATTERN_STRICT = _month_day_year_pattern("4")
MONTH_YEAR_ONLY_PATTERN = re.compile(
    r"(?i)(?<![A-Za-z])(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]+(\d{4})(?!\d)"
)
# "nov 25.pdf" (Wells Fargo's convention: Month + 2-digit year, no day at
# all) has no separator-then-more-digits after the "25" for
# MONTH_DAY_YEAR_PATTERN to require, and only 2 digits where
# MONTH_YEAR_ONLY_PATTERN needs 4 -- so without this it silently finds no
# date at all for every file in the whole app. Filename-only (never used
# for body text): a bare 2-digit number after a month name in free-flowing
# prose is far too easy to confuse with something else.
MONTH_YEAR_SHORT_PATTERN = re.compile(
    r"(?i)(?<![A-Za-z])(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]+(\d{2})(?!\d)"
)
# Tax-return-style filenames ("Patrick Dean TurboTax 2025 1040.pdf",
# "2025_TaxReturn.pdf") often carry only a bare year with no month or day
# at all -- which is all a tax document needs anyway. Tried dead last,
# filename-only: bounded to a plausible year (1990-2099) so it doesn't
# latch onto an arbitrary 4-digit account/document ID, but body text still
# skips this entirely since prose has far more stray 4-digit numbers.
BARE_YEAR_PATTERN = re.compile(
    r"(?<!\d)(\d{4})(?!\d)"
)
DAY_FIRST_PATTERN = _day_first_pattern("2,4")
DAY_FIRST_PATTERN_STRICT = _day_first_pattern("4")


def _plausible_year(year: int) -> bool:
    return 1990 <= year <= 2099


def _expand_year(year_text: str) -> int:
    return int(year_text) if len(year_text) == 4 else 2000 + int(year_text)


def _extract_named_month_date(text: str, strict_year: bool = False) -> Optional[date]:
    day_first = DAY_FIRST_PATTERN_STRICT if strict_year else DAY_FIRST_PATTERN
    month_day_year = MONTH_DAY_YEAR_PATTERN_STRICT if strict_year else MONTH_DAY_YEAR_PATTERN

    match = day_first.search(text)
    if match:
        month = MONTH_NAMES.get(match.group(2).lower())
        year = _expand_year(match.group(3))
        if _plausible_year(year):
            try:
                return date(year, month, int(match.group(1)))
            except ValueError:
                pass
    match = month_day_year.search(text)
    if match:
        month = MONTH_NAMES.get(match.group(1).lower())
        year = _expand_year(match.group(3))
        if _plausible_year(year):
            try:
                return date(year, month, int(match.group(2)))
            except ValueError:
                pass
    match = MONTH_YEAR_ONLY_PATTERN.search(text)
    if match:
        month = MONTH_NAMES.get(match.group(1).lower())
        year = int(match.group(2))
        if _plausible_year(year):
            try:
                return date(year, month, 1)
            except ValueError:
                pass
    if strict_year:
        return None
    match = MONTH_YEAR_SHORT_PATTERN.search(text)
    if match:
        month = MONTH_NAMES.get(match.group(1).lower())
        year = _expand_year(match.group(2))
        if _plausible_year(year):
            try:
                return date(year, month, 1)
            except ValueError:
                pass
    match = BARE_YEAR_PATTERN.search(text)
    if match:
        year = int(match.group(1))
        if _plausible_year(year):
            return date(year, 1, 1)
    return None


def _try_numeric_patterns(text: str, patterns) -> Optional[date]:
    for pattern, (year_group, month_group, day_group) in patterns:
        match = pattern.search(text)
        if not match:
            continue
        year = _expand_year(match.group(year_group))
        if not _plausible_year(year):
            continue
        try:
            return date(
                year,
                int(match.group(month_group)),
                int(match.group(day_group)) if day_group else 1,
            )
        except ValueError:
            continue
    return None


def _search_date_patterns(text: str, patterns, strict_year: bool = False, named_month_first: bool = False) -> Optional[date]:
    if named_month_first:
        # Free-flowing document text -- unlike a filename -- often contains
        # more than one date-shaped thing (a statement period *and* an
        # unrelated "effective as of MM-DD-YYYY" disclaimer, say). The
        # named-month phrasing ("October 1 - October 31, 2025") is far more
        # likely to actually be the document's own period than a bare
        # numeric date buried in fine print, so it's tried first here.
        return _extract_named_month_date(text, strict_year=strict_year) or _try_numeric_patterns(text, patterns)
    return _try_numeric_patterns(text, patterns) or _extract_named_month_date(text, strict_year=strict_year)


def extract_date_from_filename(filename: str) -> Optional[date]:
    return _search_date_patterns(filename, DATE_PATTERNS)


def extract_date_from_text(text: str) -> Optional[date]:
    return _search_date_patterns(text, BODY_TEXT_DATE_PATTERNS, strict_year=True, named_month_first=True)


_PDF_DATE_SCAN_PAGES = 2  # a statement period / tax year is almost always on page 1-2


def _ocr_page_text(page: "fitz.Page") -> str:
    """Render a page to an image and OCR it -- only reached when the page
    has no real text layer (a scan). Returns '' if OCR isn't available
    (Tesseract not installed) or fails for any reason; this is a
    best-effort fallback, not a hard requirement.

    Privacy note: the rendered image and the OCR'd text exist only as this
    function's local variables. Nothing here is cached, logged, or written
    to disk -- both are freed the instant this call returns (CPython drops
    an object's memory as soon as its last reference goes away, so this
    isn't "cleaned up within a minute", it's gone essentially immediately)."""
    if not _OCR_AVAILABLE:
        return ""
    try:
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.open(io.BytesIO(pixmap.tobytes("png")))
        return pytesseract.image_to_string(image)
    except Exception:
        return ""


def extract_date_from_pdf(content: bytes) -> Optional[date]:
    """Find a statement/document date inside a PDF, trying the real text
    layer first and only falling back to OCR when that comes back empty
    (i.e. the page is a scanned image with no text layer at all).

    Privacy note: whatever text is read here -- from the text layer or
    from OCR -- lives only in this function's local variables and is
    discarded the moment it returns a plain date (or None). The report
    that comes out of this module never contains the extracted text
    itself, only the date derived from it."""
    try:
        pdf = fitz.open(stream=content, filetype="pdf")
    except Exception:
        return None
    try:
        for page_number in range(min(_PDF_DATE_SCAN_PAGES, len(pdf))):
            page = pdf[page_number]
            text = page.get_text().strip()
            if not text:
                text = _ocr_page_text(page).strip()
            if not text:
                continue
            found = extract_date_from_text(text)
            if found:
                return found
    finally:
        pdf.close()
    return None


def _is_junk_path(relative_path: Path) -> bool:
    name = relative_path.name
    lower = name.lower()
    if lower in {".ds_store", "thumbs.db"}:
        return True
    if lower.endswith(".tmp"):
        return True
    if name.startswith("~$"):
        return True
    if any(part == "__MACOSX" for part in relative_path.parts):
        return True
    if name.startswith("."):
        return True
    return False


_TRAILING_TIMEZONE_RE = re.compile(r"\s+[A-Z]{2,5}$")


def _parse_date_value(raw: str) -> Optional[date]:
    raw = raw.strip()
    if not raw:
        return None
    # Cash App (and others) append a timezone abbreviation --
    # "2026-08-24 13:34:29 EDT" -- which strptime's fixed formats below
    # don't account for and would otherwise silently reject every single
    # row's date, one at a time, with no error to notice.
    candidates = [raw]
    stripped = _TRAILING_TIMEZONE_RE.sub("", raw)
    if stripped != raw:
        candidates.append(stripped)
    from datetime import datetime
    for candidate in candidates:
        for fmt in _DATETIME_FORMATS:
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
    return None


def _parse_amount(raw: str) -> Optional[float]:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    text = text.replace("$", "").replace(",", "").replace("+", "").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return -value if negative else value


def _find_header_row(rows: list[list[str]]) -> Optional[int]:
    """Real exports (e.g. Venmo) put a title/summary row or two before the
    actual column header, so the header can't be assumed to be row 0."""
    for index, row in enumerate(rows[:10]):
        lowered = {cell.strip().lower() for cell in row if cell.strip()}
        if lowered & DATE_COLUMN_NAMES:
            return index
    return None


def analyze_csv(name: str, content: bytes) -> dict:
    """Check 2/3 (CSV half): date parsing, month coverage, balance-chain
    math. Returns a dict describing what was found, or an 'error' key if
    the file couldn't be read at all."""
    try:
        text = content.decode("utf-8-sig", errors="replace")
    except Exception as exc:
        return {"file": name, "error": f"Could not decode: {exc}"}

    rows = list(csv.reader(io.StringIO(text, newline="")))
    header_index = _find_header_row(rows)
    if header_index is None:
        return {"file": name, "error": "No recognizable date column found."}

    header = [cell.strip() for cell in rows[header_index]]
    header_lower = [cell.lower() for cell in header]
    data_rows = rows[header_index + 1:]

    def col_index(names: set[str]) -> Optional[int]:
        for wanted in names:
            if wanted in header_lower:
                return header_lower.index(wanted)
        return None

    date_col = col_index(DATE_COLUMN_NAMES)
    balance_col = col_index(BALANCE_COLUMN_NAMES)
    amount_col = col_index(AMOUNT_COLUMN_NAMES)
    begin_col = col_index(BEGIN_BALANCE_NAMES)
    end_col = col_index(END_BALANCE_NAMES)
    description_col = col_index(DESCRIPTION_COLUMN_NAMES)

    months = set()
    parsed_dates = []
    # One row per actual transaction (date + amount both present), kept for
    # Check 4/5's activity and coherency analysis so those don't need to
    # re-parse the same file a second time.
    transactions = []
    for row in data_rows:
        if date_col is None or date_col >= len(row):
            continue
        parsed = _parse_date_value(row[date_col])
        if parsed:
            parsed_dates.append(parsed)
            months.add((parsed.year, parsed.month))
        row_amount = _parse_amount(row[amount_col]) if amount_col is not None and amount_col < len(row) else None
        row_description = row[description_col].strip() if description_col is not None and description_col < len(row) else ""
        if parsed and row_amount is not None:
            transactions.append({"date": parsed, "amount": row_amount, "description": row_description})

    balance_findings = []
    if balance_col is not None and amount_col is not None:
        # A genuine per-row running balance: verify prev + amount ~= current
        # for every consecutive pair, in file order.
        previous_balance = None
        for row_number, row in enumerate(data_rows, start=header_index + 2):
            if balance_col >= len(row) or amount_col >= len(row):
                continue
            balance = _parse_amount(row[balance_col])
            amount = _parse_amount(row[amount_col])
            if balance is None:
                continue
            if previous_balance is not None and amount is not None:
                expected = previous_balance + amount
                if abs(expected - balance) > 0.02:
                    balance_findings.append(
                        f"{name} row {row_number}: expected balance {expected:.2f} "
                        f"(prev {previous_balance:.2f} + {amount:.2f}) but found {balance:.2f}."
                    )
            previous_balance = balance
    elif begin_col is not None and end_col is not None and amount_col is not None:
        # No per-row balance -- Venmo-style exports instead give scalar
        # beginning/ending balance values sprinkled in the sheet, so the
        # check becomes: does the sum of every amount reconcile the two?
        begin_value = end_value = None
        total_amount = 0.0
        for row in data_rows:
            if begin_col < len(row) and row[begin_col].strip():
                parsed = _parse_amount(row[begin_col])
                if parsed is not None:
                    begin_value = parsed
            if end_col < len(row) and row[end_col].strip():
                parsed = _parse_amount(row[end_col])
                if parsed is not None:
                    end_value = parsed
            if amount_col < len(row):
                parsed = _parse_amount(row[amount_col])
                if parsed is not None:
                    total_amount += parsed
        if begin_value is not None and end_value is not None:
            expected_end = begin_value + total_amount
            if abs(expected_end - end_value) > 0.02:
                balance_findings.append(
                    f"{name}: beginning balance {begin_value:.2f} + sum of amounts {total_amount:.2f} "
                    f"= {expected_end:.2f}, but ending balance states {end_value:.2f}."
                )

    return {
        "file": name,
        "months": sorted(months),
        "row_count": len(data_rows),
        "date_range": (min(parsed_dates), max(parsed_dates)) if parsed_dates else None,
        "balance_findings": balance_findings,
        "transactions": transactions,
    }


def check_completeness(app_entries: dict[str, list[tuple[str, bytes]]], metadata: Optional[dict], manifest: Optional[dict]) -> dict:
    """Check 1 -- Completeness. Returns per-app findings plus anything that
    isn't about one specific app (the submission-wide file count)."""
    per_app: dict[str, list[str]] = defaultdict(list)
    submission_level: list[str] = []

    declared_apps = {app["app"]: app for app in (metadata or {}).get("apps", [])}
    for app_name, entries in app_entries.items():
        declared = declared_apps.get(app_name)
        actual_count = len(entries)
        if declared is not None:
            expected = declared.get("exported_file_count")
            if expected is not None and expected != actual_count:
                per_app[app_name].append(f"metadata.json declares {expected} exported file(s) but {actual_count} found on disk.")
        elif metadata is not None:
            per_app[app_name].append("Folder present on disk but not declared in metadata.json apps[].")

    for app_name, declared in declared_apps.items():
        if app_name not in app_entries:
            per_app[app_name].append(f"Declared in metadata.json ({declared.get('exported_file_count')} file(s)) but folder missing from the ZIP.")

    total_actual = sum(len(entries) for entries in app_entries.values())
    if manifest is not None:
        declared_total = manifest.get("total_files")
        if declared_total is not None and declared_total != total_actual:
            submission_level.append(f"manifest.json declares total_files={declared_total} but {total_actual} data file(s) found (excluding manifest/metadata/review/catalog).")

    for app_name, entries in app_entries.items():
        hashes = defaultdict(list)
        for entry_name, content in entries:
            if len(content) == 0:
                per_app[app_name].append(f"{entry_name}: zero-byte file.")
            hashes[hashlib.md5(content).hexdigest()].append(entry_name)
        for names in hashes.values():
            if len(names) > 1:
                per_app[app_name].append(f"Exact duplicate files (identical content): {', '.join(sorted(names))}.")

    if metadata and metadata.get("unattributed_files"):
        submission_level.append(f"metadata.json reports {metadata['unattributed_files']} unattributed file(s).")

    return {
        "per_app": {app: {"passed": not findings, "findings": findings} for app, findings in per_app.items()},
        "submission_level": submission_level,
    }


def check_file_hygiene(app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Check 8 -- File Hygiene, run per app so a junk file or wrong file
    type is attributed to the app it was found in."""
    per_app: dict[str, list[str]] = {}
    for app_name, entries in app_entries.items():
        findings = []
        for entry_name, content in entries:
            relative_path = Path(entry_name)
            if _is_junk_path(relative_path):
                findings.append(f"{entry_name}: junk/system file that shouldn't be in the export.")
                continue
            suffix = relative_path.suffix.lower()
            if suffix not in EXPECTED_EXTENSIONS:
                findings.append(f"{entry_name}: unexpected file type ({suffix or 'no extension'}).")
            if 0 < len(content) < 100:
                findings.append(f"{entry_name}: suspiciously small file ({len(content)} bytes).")
        per_app[app_name] = {"passed": not findings, "findings": findings}
    return {"per_app": per_app, "submission_level": []}


_MONTH_DISPLAY_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _format_month(year_month: tuple[int, int]) -> str:
    year, month = year_month
    return f"{_MONTH_DISPLAY_NAMES[month - 1]} {year}"


def collect_pdf_months(entries: list[tuple[str, bytes]]) -> tuple[set[tuple[int, int]], list[str]]:
    """A PDF's month is read from its filename first (free, no need to open
    the file), and only falls back to opening + reading/OCR-ing its content
    when the filename doesn't encode a date at all."""
    months = set()
    parse_errors = []
    for name, content in entries:
        if not name.lower().endswith(".pdf"):
            continue
        found = extract_date_from_filename(name)
        if found is None:
            found = extract_date_from_pdf(content)
        if found is None:
            parse_errors.append(f"{name}: no date found in filename or document content.")
            continue
        months.add((found.year, found.month))
    return months, parse_errors


def check_time_coverage(app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Check 2 + Check 3: date parsing/balance math for CSVs, PDF dates via
    filename or content/OCR, then 12-consecutive-month coverage per
    transaction-based app. Every app gets a result (not just failing
    ones) so the report can always show what was actually found."""
    per_app = {}
    for app_name, entries in app_entries.items():
        csv_entries = [(name, content) for name, content in entries if name.lower().endswith(".csv")]
        pdf_entries = [(name, content) for name, content in entries if name.lower().endswith(".pdf")]
        if not csv_entries and not pdf_entries:
            continue
        is_snapshot = app_name.lower() in SNAPSHOT_APPS

        analyses = [analyze_csv(name, content) for name, content in csv_entries]
        months = set()
        balance_findings = []
        parse_errors = []
        for analysis in analyses:
            if "error" in analysis:
                parse_errors.append(f"{analysis['file']}: {analysis['error']}")
                continue
            months.update(analysis["months"])
            balance_findings.extend(analysis["balance_findings"])

        pdf_months, pdf_parse_errors = collect_pdf_months(pdf_entries)
        months.update(pdf_months)
        # A snapshot app (tax returns, credit reports) isn't required to
        # have a parseable month at all -- Check 3 treats it as N/A -- so a
        # PDF without one there isn't a real problem worth flagging, unlike
        # for a transaction-based app where it is.
        if not is_snapshot:
            parse_errors.extend(pdf_parse_errors)

        gap_findings = []
        full_coverage = None
        if not is_snapshot and months:
            ordered = sorted(months)
            span_months = (ordered[-1][0] - ordered[0][0]) * 12 + (ordered[-1][1] - ordered[0][1]) + 1
            expected = set()
            year, month = ordered[0]
            for _ in range(span_months):
                expected.add((year, month))
                month += 1
                if month > 12:
                    month = 1
                    year += 1
            missing = sorted(expected - months)
            full_coverage = span_months >= 12 and not missing
            if span_months < 12:
                gap_findings.append(f"Only spans {span_months} month(s) ({_format_month(ordered[0])} to {_format_month(ordered[-1])}), need >= 12.")
            if missing:
                gap_findings.append(f"Missing month(s) in an otherwise-spanning range: {', '.join(_format_month(m) for m in missing)}.")

        summary = []
        if is_snapshot:
            summary.append("Snapshot/supplementary app -- 12-month coverage not applicable.")
        elif months:
            ordered = sorted(months)
            coverage_text = "full 12-month coverage" if full_coverage else f"{len(ordered)} distinct month(s) found, NOT full 12-month coverage"
            summary.append(f"Months present ({coverage_text}): {', '.join(_format_month(m) for m in ordered)}.")
        else:
            summary.append("No dated months found in any file.")

        findings = balance_findings + gap_findings + parse_errors
        per_app[app_name] = {
            "passed": not findings,
            "findings": findings,
            "summary": summary,
        }

    return {"per_app": per_app, "submission_level": []}


def load_control_json(all_entries: list[tuple[str, bytes]], filename: str) -> Optional[dict]:
    """manifest.json/metadata.json/review.json/catalog.json can sit at any
    depth (project root vs. per-contributor folder), so find the first
    match by filename rather than assuming a fixed path."""
    for raw_path, content in all_entries:
        if Path(raw_path).name == filename:
            try:
                return json.loads(content.decode("utf-8-sig"))
            except Exception:
                return None
    return None


def check_activity_authenticity(app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Check 4 -- Activity & Authenticity. Only meaningful where there's
    actual per-transaction CSV data to count and compare; PDF-only apps
    have no structured rows to analyze this way, and snapshot apps aren't
    transaction histories at all, so both are marked N/A rather than
    guessed at."""
    per_app = {}
    for app_name, entries in app_entries.items():
        csv_entries = [(name, content) for name, content in entries if name.lower().endswith(".csv")]
        is_snapshot = app_name.lower() in SNAPSHOT_APPS
        if is_snapshot:
            per_app[app_name] = {"passed": True, "findings": [], "summary": ["Snapshot/supplementary app -- activity check not applicable."]}
            continue
        if not csv_entries:
            per_app[app_name] = {"passed": True, "findings": [], "summary": ["No CSV transaction data available to analyze (PDF-only app)."]}
            continue

        transactions = []
        for name, content in csv_entries:
            transactions.extend(analyze_csv(name, content).get("transactions", []))

        if not transactions:
            per_app[app_name] = {"passed": True, "findings": [], "summary": ["No parseable transactions found."]}
            continue

        findings = []
        summary = []

        months_seen = defaultdict(int)
        for txn in transactions:
            months_seen[(txn["date"].year, txn["date"].month)] += 1
        avg_per_month = len(transactions) / len(months_seen) if months_seen else 0
        summary.append(f"{len(transactions)} transaction(s) across {len(months_seen)} month(s), averaging {avg_per_month:.1f}/month.")
        if avg_per_month < 10:
            findings.append(f"Average of {avg_per_month:.1f} transaction(s)/month is below the 10/month expectation for real activity.")

        descriptions = [txn["description"].lower() for txn in transactions if txn["description"]]
        if descriptions:
            description_counts = defaultdict(int)
            for description in descriptions:
                description_counts[description] += 1
            top_description, top_description_count = max(description_counts.items(), key=lambda kv: kv[1])
            top_description_share = top_description_count / len(descriptions)
            summary.append(f"{len(description_counts)} distinct description(s) across {len(descriptions)} transaction(s) with one.")
            if top_description_share > 0.5 and len(descriptions) >= 10:
                findings.append(f"One description (\"{top_description}\") accounts for {top_description_share:.0%} of all transactions -- low merchant/description variety.")

        amount_counts = defaultdict(int)
        for txn in transactions:
            amount_counts[round(txn["amount"], 2)] += 1
        top_amount, top_amount_count = max(amount_counts.items(), key=lambda kv: kv[1])
        top_amount_share = top_amount_count / len(transactions)
        if top_amount_share > 0.3 and top_amount_count >= 5:
            findings.append(f"Amount {top_amount:.2f} repeats {top_amount_count} time(s) ({top_amount_share:.0%} of all transactions) -- check for copy-pasted/fabricated rows.")

        round_count = sum(1 for txn in transactions if abs(txn["amount"] - round(txn["amount"])) < 0.001)
        round_share = round_count / len(transactions)
        if round_share > 0.7 and len(transactions) >= 10:
            findings.append(f"{round_share:.0%} of transactions are round whole-dollar amounts -- unusually high for organic activity.")

        per_app[app_name] = {"passed": not findings, "findings": findings, "summary": summary}
    return {"per_app": per_app, "submission_level": []}


def check_data_coherency(app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Check 5 (intra-app half) -- does each file's own transaction content
    actually match the month its filename implies? Cross-app corroboration
    (matching a bank debit to a credit card payment, say) isn't implemented:
    doing that safely needs amount/date-window matching tuned against more
    real examples than are available yet, and a wrong match here would be
    actively misleading rather than just incomplete."""
    per_app = {}
    for app_name, entries in app_entries.items():
        csv_entries = [(name, content) for name, content in entries if name.lower().endswith(".csv")]
        if not csv_entries:
            continue
        findings = []
        checked = 0
        for name, content in csv_entries:
            filename_date = extract_date_from_filename(name)
            if filename_date is None:
                continue
            analysis = analyze_csv(name, content)
            if "error" in analysis or not analysis["months"]:
                continue
            checked += 1
            expected = (filename_date.year, filename_date.month)
            if expected not in analysis["months"]:
                actual = ", ".join(_format_month(month) for month in analysis["months"])
                findings.append(f"{name}: filename implies {_format_month(expected)}, but its transactions are dated {actual}.")
        summary = [f"Checked {checked} file(s) for filename-vs-content date consistency."] if checked else \
            ["No files had both a filename date and parseable transaction dates to cross-check."]
        per_app[app_name] = {"passed": not findings, "findings": findings, "summary": summary}
    return {"per_app": per_app, "submission_level": []}


def check_artifacts(app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Check 6 -- Artifacts. The artifacts/ and other__* folders hold
    non-export files (budgets, trackers, screenshots) rather than app
    exports; this only verifies they're actually readable in a format the
    tool understands. Exact duplicates are already caught by Check 1 and
    aren't repeated here."""
    per_app = {}
    for app_name, entries in app_entries.items():
        if app_name.lower() != "artifacts" and not app_name.lower().startswith("other__"):
            continue
        findings = []
        for name, content in entries:
            suffix = Path(name).suffix.lower()
            try:
                if suffix == ".pdf":
                    fitz.open(stream=content, filetype="pdf").close()
                elif suffix == ".xlsx":
                    from openpyxl import load_workbook
                    load_workbook(io.BytesIO(content), read_only=True).close()
                elif suffix == ".csv":
                    content.decode("utf-8-sig")
            except Exception as exc:
                findings.append(f"{name}: not readable as a {suffix or 'recognized'} file ({exc}).")
        summary = [f"{len(entries)} artifact file(s) checked for readability."]
        per_app[app_name] = {"passed": not findings, "findings": findings, "summary": summary}
    return {"per_app": per_app, "submission_level": []}


CHECK_LABELS = {
    "completeness": "Completeness",
    "file_hygiene": "File Hygiene",
    "time_coverage": "Time Coverage & Balances",
    "activity_authenticity": "Activity & Authenticity",
    "data_coherency": "Data Coherency",
    "artifacts": "Artifacts",
}
_EMPTY_CHECK = {"passed": True, "findings": [], "summary": []}


def _generate_remediation(apps: dict) -> list[str]:
    """Check 9's remediation list: concrete, per-app-and-check pointers at
    exactly what needs fixing, rather than a generic "something failed"."""
    steps = []
    for app_name in sorted(apps):
        data = apps[app_name]
        if data["passed"]:
            continue
        for check_key, result in data["checks"].items():
            if result["passed"]:
                continue
            label = CHECK_LABELS.get(check_key, check_key)
            steps.append(f"{app_name} -- {label}: {' '.join(result['findings'])}")
    return steps


def run_phase1_review(all_entries: list[tuple[str, bytes]], app_entries: dict[str, list[tuple[str, bytes]]]) -> dict:
    """Entry point: runs every implemented check and returns a report
    organized app-first (each app's own pass/fail across every check),
    matching the Golden Rule that a submission is only as good as its worst
    app. Check 7 (PII/BII) isn't implemented yet -- pending a decision on
    regex-only vs. a local NLP model for name detection -- so a PASS/
    APPROVED verdict here does NOT mean the submission is free of PII."""
    manifest = load_control_json(all_entries, "manifest.json")
    metadata = load_control_json(all_entries, "metadata.json")
    review = load_control_json(all_entries, "review.json")

    results = {
        "completeness": check_completeness(app_entries, metadata, manifest),
        "file_hygiene": check_file_hygiene(app_entries),
        "time_coverage": check_time_coverage(app_entries),
        "activity_authenticity": check_activity_authenticity(app_entries),
        "data_coherency": check_data_coherency(app_entries),
        "artifacts": check_artifacts(app_entries),
    }

    app_names = sorted(app_entries.keys())
    apps = {}
    for app_name in app_names:
        checks = {
            key: result["per_app"].get(app_name, _EMPTY_CHECK)
            for key, result in results.items()
        }
        apps[app_name] = {"checks": checks, "passed": all(check["passed"] for check in checks.values())}

    submission_level_findings = [
        finding for result in results.values() for finding in result["submission_level"]
    ]

    overall_passed = not submission_level_findings and all(app["passed"] for app in apps.values())
    remediation = _generate_remediation(apps)
    if submission_level_findings:
        remediation = [f"Submission-level: {finding}" for finding in submission_level_findings] + remediation

    return {
        "phase": 1,
        "note": "Checks 1-6, 8 implemented (Completeness, Time Coverage & Balances, "
                "Activity & Authenticity, Data Coherency [intra-app only -- cross-app "
                "corroboration not implemented], Artifacts, File Hygiene). Check 7 "
                "(PII/BII) is NOT implemented -- an APPROVED decision here does NOT "
                "mean the submission is free of unmasked PII.",
        "has_manifest": manifest is not None,
        "has_metadata": metadata is not None,
        "has_review": review is not None,
        "check_labels": CHECK_LABELS,
        "apps": apps,
        "submission_level_findings": submission_level_findings,
        "overall_passed": overall_passed,
        "decision": "APPROVED" if overall_passed else "REJECTED",
        "remediation": remediation,
    }
