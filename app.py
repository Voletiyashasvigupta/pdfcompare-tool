import csv
import io
import re
from datetime import date
from pathlib import Path
from typing import Optional
from zipfile import ZipFile
from typing import Annotated, Dict, Union
from uuid import uuid4

import fitz
from openpyxl import load_workbook
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
MAX_FILE_SIZE = 500 * 1024 * 1024
PREVIEW_ROW_LIMIT = 5000
PREVIEW_COLUMN_LIMIT = 60

app = FastAPI(title="PDF Compare")
files: Dict[str, Dict[str, Union[bytes, str, int]]] = {}

def _plausible_year(year: int) -> bool:
    return 1990 <= year <= 2099


# Each entry is (regex, (year_group, month_group, day_group)); day_group may
# be None when the filename only encodes a month and year, in which case the
# day defaults to the 1st for sorting purposes. Patterns are tried in order
# from most specific (separators, exact day) to least specific (bare digit
# runs), since the first successful match wins.
DATE_PATTERNS = [
    (re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})_(\d{1,2})_(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{4})\.(\d{1,2})\.(\d{1,2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})_(\d{1,2})_(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)"), (1, 2, 3)),
    (re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)"), (3, 1, 2)),
    (re.compile(r"(?<!\d)(\d{4})-(\d{1,2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{4})_(\d{1,2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{1,2})-(\d{4})(?!\d)"), (2, 1, None)),
    (re.compile(r"(?<!\d)(\d{1,2})_(\d{4})(?!\d)"), (2, 1, None)),
    (re.compile(r"(?<!\d)(\d{4})(\d{2})(?!\d)"), (1, 2, None)),
    (re.compile(r"(?<!\d)(\d{2})(\d{4})(?!\d)"), (2, 1, None)),
]

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
MONTH_FIRST_PATTERN = re.compile(
    r"(?i)(?<![A-Za-z])(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]*(?:(\d{1,2})[ _.\-,]+)?(\d{2,4})(?!\d)"
)
DAY_FIRST_PATTERN = re.compile(
    r"(?i)(?<!\d)(\d{1,2})[ _.\-]*(" + _MONTH_NAME_RE + r")[a-z]*[ _.\-]*(\d{2,4})(?!\d)"
)


def _expand_year(year_text: str) -> int:
    return int(year_text) if len(year_text) == 4 else 2000 + int(year_text)


def _extract_named_month_date(filename: str) -> Optional[date]:
    match = DAY_FIRST_PATTERN.search(filename)
    if match:
        month = MONTH_NAMES.get(match.group(2).lower())
        year = _expand_year(match.group(3))
        if _plausible_year(year):
            try:
                return date(year, month, int(match.group(1)))
            except ValueError:
                pass
    match = MONTH_FIRST_PATTERN.search(filename)
    if match:
        month = MONTH_NAMES.get(match.group(1).lower())
        day = int(match.group(2)) if match.group(2) else 1
        year = _expand_year(match.group(3))
        if _plausible_year(year):
            try:
                return date(year, month, day)
            except ValueError:
                pass
    return None


def extract_date_from_filename(filename: str) -> Optional[date]:
    for pattern, (year_group, month_group, day_group) in DATE_PATTERNS:
        match = pattern.search(filename)
        if not match:
            continue
        year = int(match.group(year_group))
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
    return _extract_named_month_date(filename)


KNOWN_APP_FOLDERS = {
    "artifacts",
    "capital_one_cards",
    "cash_app_p2p",
    "experian",
    "irs_gov",
    "navy_federal_cu",
    "rocket_mortgage",
}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def register_document(filename: str, content: bytes) -> Dict[str, Union[str, int]]:
    extension = Path(filename).suffix.lower()
    if extension not in {".pdf", ".xlsx", ".csv"}:
        raise ValueError("Only PDF, XLSX, and CSV files are supported.")
    if not content:
        raise ValueError("The file is empty.")
    if len(content) > MAX_FILE_SIZE:
        raise ValueError("Files must be 500 MB or smaller.")

    document_id = uuid4().hex
    kind = "pdf" if extension == ".pdf" else extension[1:]
    page_count = 0
    if kind == "pdf":
        try:
            pdf = fitz.open(stream=content, filetype="pdf")
            page_count = len(pdf)
            pdf.close()
        except Exception as exc:
            raise ValueError(f"Could not read PDF: {exc}") from exc
    else:
        try:
            if kind == "xlsx":
                workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
                workbook.close()
            else:
                content.decode("utf-8-sig")
        except Exception as exc:
            raise ValueError(f"Could not read spreadsheet: {exc}") from exc

    files[document_id] = {
        "name": filename,
        "content": content,
        "kind": kind,
        "page_count": page_count,
    }
    return {
        "id": document_id,
        "name": files[document_id]["name"],
        "size": len(content),
        "kind": kind,
        "page_count": page_count,
    }


@app.post("/api/documents")
async def upload_document(file: Annotated[UploadFile, File(...)]) -> Dict[str, Union[str, int]]:
    filename = file.filename or "Untitled"
    content = await file.read()
    try:
        return register_document(filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/archive")
async def upload_archive(file: Annotated[UploadFile, File(...)]) -> dict:
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=415, detail="Only ZIP files are supported.")
    archive = await file.read()
    if len(archive) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="ZIP files must be 500 MB or smaller.")

    folders: Dict[str, list] = {}
    try:
        with ZipFile(io.BytesIO(archive)) as zip_file:
            entries = [
                entry for entry in zip_file.infolist()
                if not entry.is_dir()
                and Path(entry.filename).suffix.lower() in {".pdf", ".xlsx", ".csv"}
            ]

            for entry in entries:
                relative_path = Path(entry.filename)
                if relative_path.is_absolute() or ".." in relative_path.parts:
                    continue
                if relative_path.suffix.lower() not in {".pdf", ".xlsx", ".csv"}:
                    continue
                # Prefer a directory segment matching a known app name, wherever
                # it sits in the path, so files are grouped consistently even
                # if a case/wrapper folder sits above the app folder at an
                # inconsistent depth.
                folder_name = next(
                    (part for part in relative_path.parts[:-1] if part.lower() in KNOWN_APP_FOLDERS),
                    None,
                )
                if folder_name is None:
                    # No recognized app name in the path -- fall back to the
                    # file's immediate containing folder, whatever it's
                    # called, so distinct subfolders always end up as
                    # distinct columns instead of collapsing into one.
                    folder_name = relative_path.parts[-2] if len(relative_path.parts) >= 2 else "Root files"
                try:
                    document = register_document(relative_path.name, zip_file.read(entry))
                except ValueError:
                    continue
                document["folder"] = folder_name
                folders.setdefault(folder_name, []).append(document)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read ZIP: {exc}") from exc

    if not folders:
        raise HTTPException(status_code=422, detail="The ZIP contains no supported PDF, CSV, or XLSX files.")

    for documents in folders.values():
        dated = [doc for doc in documents if extract_date_from_filename(str(doc["name"])) is not None]
        undated = [doc for doc in documents if doc not in dated]
        dated.sort(key=lambda doc: extract_date_from_filename(str(doc["name"])))
        documents[:] = dated + undated
    return {"folders": [{"name": name, "documents": documents} for name, documents in folders.items()]}


@app.get("/api/documents/{document_id}/preview")
def get_spreadsheet_preview(document_id: str) -> dict:
    document = files.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    kind = document["kind"]
    if kind == "pdf":
        raise HTTPException(status_code=400, detail="PDFs do not have a spreadsheet preview.")

    if kind == "csv":
        source = io.StringIO(document["content"].decode("utf-8-sig"), newline="")
        all_rows = list(csv.reader(source))
        rows = all_rows[:PREVIEW_ROW_LIMIT]
        return {"sheets": [{
            "name": "CSV",
            "rows": rows,
            "truncated": len(all_rows) > PREVIEW_ROW_LIMIT,
            "total_rows": len(all_rows),
        }]}

    try:
        workbook = load_workbook(io.BytesIO(document["content"]), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read spreadsheet: {exc}") from exc

    sheets = []
    try:
        for worksheet in workbook.worksheets:
            rows = []
            total_rows = 0
            truncated = False
            try:
                for row in worksheet.iter_rows(values_only=True):
                    total_rows += 1
                    if len(rows) < PREVIEW_ROW_LIMIT:
                        rows.append(["" if value is None else str(value) for value in row[:PREVIEW_COLUMN_LIMIT]])
                    else:
                        truncated = True
            except Exception as exc:
                rows.append([f"Preview stopped: {exc}"])
            sheets.append({"name": worksheet.title, "rows": rows, "truncated": truncated, "total_rows": total_rows})
    finally:
        workbook.close()
    return {"sheets": sheets}


DOWNLOAD_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
}


@app.get("/api/documents/{document_id}")
def get_document(document_id: str) -> Response:
    document = files.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="File not found.")
    media_type = DOWNLOAD_MEDIA_TYPES.get(document["kind"], "application/octet-stream")
    safe_name = str(document["name"]).replace('"', "'")
    return Response(
        content=document["content"],
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@app.get("/api/documents/{document_id}/pages/{page_number}")
def get_page(document_id: str, page_number: int) -> Response:
    document = files.get(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="PDF not found.")
    page_count = int(document["page_count"])
    if page_number < 0 or page_number >= page_count:
        raise HTTPException(status_code=404, detail="Page not found.")

    pdf = fitz.open(stream=document["content"], filetype="pdf")
    try:
        pixmap = pdf[page_number].get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
        return Response(content=pixmap.tobytes("png"), media_type="image/png")
    finally:
        pdf.close()


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str) -> dict[str, bool]:
    if files.pop(document_id, None) is None:
        raise HTTPException(status_code=404, detail="PDF not found.")
    return {"deleted": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def no_cache_static(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response
