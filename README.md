# PDF Side-by-Side Viewer (Python)

A desktop app (PySide6 + PyMuPDF) for viewing multiple PDFs side by side, each in its own scrollable, zoomable column.

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## Run

```bash
./venv/bin/python pdf_viewer.py               # empty, then use "Add PDFs" or drag & drop
./venv/bin/python pdf_viewer.py a.pdf b.pdf   # open with files preloaded
```

## Features

- Add any number of PDFs via file picker or drag & drop.
- Each column has independent zoom (+/-) and can be closed individually.
- Optional "Sync scrolling" keeps all columns scrolling together proportionally.
- "Clear All" removes every open PDF.
