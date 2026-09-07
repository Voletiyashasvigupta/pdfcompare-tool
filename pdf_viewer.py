#!/usr/bin/env python3
"""Side-by-side PDF viewer.

Open multiple PDF files and compare them in scrollable columns, each with
independent zoom, and an optional synced-scrolling mode.

Usage:
    python3 pdf_viewer.py [file1.pdf file2.pdf ...]
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QImage, QPixmap, QDragEnterEvent, QDropEvent
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QToolBar,
    QVBoxLayout,
    QWidget,
    QCheckBox,
    QMessageBox,
    QComboBox,
)

MIN_SCALE = 0.25
MAX_SCALE = 4.0
SCALE_STEP = 0.15
DEFAULT_SCALE = 1.3


def render_page_to_pixmap(page: "fitz.Page", scale: float) -> QPixmap:
    matrix = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    image = QImage(pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888)
    return QPixmap.fromImage(image.copy())


class PdfPane(QFrame):
    """A single scrollable column showing every page of one PDF."""

    def __init__(self, path: Path, on_close, on_scroll, on_move):
        super().__init__()
        self.path = path
        self.doc = fitz.open(str(path))
        self.scale = DEFAULT_SCALE
        self._on_close = on_close
        self._on_scroll = on_scroll
        self._on_move = on_move

        self.setObjectName("pdfPane")
        self.setFrameShape(QFrame.StyledPanel)
        self.setLineWidth(1)
        self.setMinimumWidth(340)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        header = QWidget()
        header.setObjectName("paneHeader")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(8, 6, 8, 6)

        title = QLabel(path.name)
        title.setObjectName("paneTitle")
        title.setToolTip(str(path))
        title.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        title.setStyleSheet("font-weight: 600;")
        header_layout.addWidget(title)

        move_left_btn = QPushButton("←")
        move_left_btn.setObjectName("moveBtn")
        move_left_btn.setFixedSize(28, 26)
        move_left_btn.setToolTip("Move PDF left")
        move_left_btn.clicked.connect(lambda: self._on_move(self, -1))
        header_layout.addWidget(move_left_btn)

        move_right_btn = QPushButton("→")
        move_right_btn.setObjectName("moveBtn")
        move_right_btn.setFixedSize(28, 26)
        move_right_btn.setToolTip("Move PDF right")
        move_right_btn.clicked.connect(lambda: self._on_move(self, 1))
        header_layout.addWidget(move_right_btn)

        self.page_label = QLabel(f"{len(self.doc)} pg")
        self.page_label.setStyleSheet("color: #94969c; font-size: 11px;")
        header_layout.addWidget(self.page_label)

        zoom_out_btn = QPushButton("-")
        zoom_out_btn.setFixedWidth(26)
        zoom_out_btn.clicked.connect(lambda: self.change_zoom(-SCALE_STEP))
        header_layout.addWidget(zoom_out_btn)

        self.zoom_label = QLabel(f"{int(self.scale * 100)}%")
        self.zoom_label.setFixedWidth(42)
        self.zoom_label.setAlignment(Qt.AlignCenter)
        header_layout.addWidget(self.zoom_label)

        zoom_in_btn = QPushButton("+")
        zoom_in_btn.setFixedWidth(26)
        zoom_in_btn.clicked.connect(lambda: self.change_zoom(SCALE_STEP))
        header_layout.addWidget(zoom_in_btn)

        close_btn = QPushButton("×")
        close_btn.setFixedWidth(26)
        close_btn.setObjectName("closeBtn")
        close_btn.clicked.connect(lambda: self._on_close(self))
        header_layout.addWidget(close_btn)

        outer.addWidget(header)

        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.verticalScrollBar().valueChanged.connect(
            lambda value: self._on_scroll(self, value)
        )

        self.pages_container = QWidget()
        self.pages_layout = QVBoxLayout(self.pages_container)
        self.pages_layout.setContentsMargins(12, 12, 12, 12)
        self.pages_layout.setSpacing(12)
        self.pages_layout.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self.scroll_area.setWidget(self.pages_container)

        outer.addWidget(self.scroll_area, stretch=1)

        self.render_pages()

    def render_pages(self):
        while self.pages_layout.count():
            item = self.pages_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        for page in self.doc:
            pixmap = render_page_to_pixmap(page, self.scale)
            page_label = QLabel()
            page_label.setPixmap(pixmap)
            page_label.setStyleSheet("background: white;")
            page_label.setAlignment(Qt.AlignCenter)
            self.pages_layout.addWidget(page_label)

    def change_zoom(self, delta: float):
        new_scale = round(min(MAX_SCALE, max(MIN_SCALE, self.scale + delta)), 2)
        if new_scale == self.scale:
            return
        self.scale = new_scale
        self.zoom_label.setText(f"{int(self.scale * 100)}%")
        self.render_pages()

    def scroll_fraction(self) -> float:
        bar = self.scroll_area.verticalScrollBar()
        span = bar.maximum() - bar.minimum()
        return 0.0 if span <= 0 else bar.value() / span

    def set_scroll_fraction(self, fraction: float):
        bar = self.scroll_area.verticalScrollBar()
        span = bar.maximum() - bar.minimum()
        bar.setValue(bar.minimum() + int(fraction * span))

    def closeEvent(self, event):
        self.doc.close()
        super().closeEvent(event)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PDF Side-by-Side Viewer")
        self.resize(1400, 900)
        self.setAcceptDrops(True)

        self.panes = []
        self._syncing = False
        self._overview = False

        toolbar = QToolBar()
        toolbar.setMovable(False)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextOnly)
        self.addToolBar(toolbar)

        add_action = QAction("Add PDFs", self)
        add_action.triggered.connect(self.pick_files)
        toolbar.addAction(add_action)

        clear_action = QAction("Clear All", self)
        clear_action.triggered.connect(self.clear_all)
        toolbar.addAction(clear_action)

        toolbar.addSeparator()
        toolbar.addWidget(QLabel("Layout"))
        self.layout_combo = QComboBox()
        self.layout_combo.addItems(["Focus scroll (auto)", "Equal widths", "Fixed width, scroll"])
        self.layout_combo.currentIndexChanged.connect(self.apply_layout)
        toolbar.addWidget(self.layout_combo)

        self.overview_button = QPushButton("⊞ Overview")
        self.overview_button.clicked.connect(self.toggle_overview)
        toolbar.addWidget(self.overview_button)

        self.sync_checkbox = QCheckBox("Sync scrolling")
        toolbar.addWidget(self.sync_checkbox)
        self.count_label = QLabel("No documents loaded")
        toolbar.addWidget(self.count_label)

        central = QWidget()
        self.setCentralWidget(central)
        self.row_layout = QHBoxLayout(central)
        self.row_layout.setContentsMargins(0, 0, 0, 0)
        self.row_layout.setSpacing(1)

        self.empty_label = QLabel(
            "📄  📄  📄\n\nAdd two or more PDFs to compare them side by side.\n"
            "Drag files here or choose them from your computer."
        )
        self.empty_label.setAlignment(Qt.AlignCenter)
        self.empty_label.setStyleSheet("color: #726d64; font-size: 14px;")
        self.row_layout.addWidget(self.empty_label)

        self.setStyleSheet(
            """
            QMainWindow, QWidget { background: #f6f5f2; color: #1c2024; }
            QToolBar { background: #f6f5f2; border: none; border-bottom: 1px solid #d8d5cf;
                       spacing: 8px; padding: 10px 14px; }
            QToolBar QLabel, QCheckBox { color: #726d64; font-size: 12px; }
            QToolButton, QPushButton, QComboBox { background: #ffffff; color: #1c2024;
                border: 1px solid #d8d5cf; border-radius: 6px; padding: 7px 11px; }
            QToolButton:hover, QPushButton:hover, QComboBox:hover { border-color: #3b5249; }
            QToolButton:first { background: #3b5249; color: white; border-color: #3b5249; }
            #pdfPane { background: #ffffff; border: 1px solid #c7c3ba; }
            #paneHeader { background: #e7ede9; border-bottom: 1px solid #c7c3ba; }
            #paneTitle { color: #1c2024; }
            QLabel { color: #1c2024; }
            QPushButton#moveBtn { border: none; background: transparent; color: #726d64; padding: 2px; }
            QPushButton#moveBtn:hover { background: #d8d5cf; color: #1c2024; }
            QPushButton#closeBtn { border: none; background: transparent; color: #726d64; padding: 3px 7px; }
            QPushButton#closeBtn:hover { background: #d8d5cf; color: #1c2024; }
            QScrollArea { background: #68655d; border: none; }
            """
        )

    def pick_files(self):
        files, _ = QFileDialog.getOpenFileNames(
            self, "Select PDF files", str(Path.home()), "PDF Files (*.pdf)"
        )
        if files:
            self.load_files(files)

    def load_files(self, paths):
        for raw_path in paths:
            path = Path(raw_path)
            if path.suffix.lower() != ".pdf" or not path.exists():
                continue
            try:
                pane = PdfPane(
                    path,
                    on_close=self.close_pane,
                    on_scroll=self.handle_scroll,
                    on_move=self.move_pane,
                )
            except Exception as exc:  # malformed / encrypted PDF, etc.
                QMessageBox.warning(self, "Failed to open PDF", f"{path.name}:\n{exc}")
                continue
            self.panes.append(pane)
            self.row_layout.addWidget(pane, stretch=1)
        self.update_empty_state()
        self.apply_layout()

    def close_pane(self, pane: PdfPane):
        self.panes.remove(pane)
        self.row_layout.removeWidget(pane)
        pane.deleteLater()
        self.update_empty_state()

    def move_pane(self, pane: PdfPane, direction: int):
        current_index = self.panes.index(pane)
        target_index = current_index + direction
        if target_index < 0 or target_index >= len(self.panes):
            return

        self.panes[current_index], self.panes[target_index] = (
            self.panes[target_index], self.panes[current_index]
        )
        self.row_layout.removeWidget(pane)
        self.row_layout.insertWidget(target_index, pane, stretch=1)

    def clear_all(self):
        for pane in self.panes[:]:
            self.close_pane(pane)

    def apply_layout(self):
        if not self.panes or self._overview:
            return
        mode = self.layout_combo.currentIndex()
        for pane in self.panes:
            pane.setMinimumWidth(480 if mode == 2 else 340)
            pane.setMaximumWidth(16777215)
        if mode == 1:
            width = max(340, self.width() // min(len(self.panes), 4))
            for pane in self.panes:
                pane.setMinimumWidth(width)

    def toggle_overview(self):
        self._overview = not self._overview
        self.overview_button.setText("⊟ Exit overview" if self._overview else "⊞ Overview")
        for pane in self.panes:
            pane.setMinimumWidth(190 if self._overview else 340)
            pane.setMaximumWidth(190 if self._overview else 16777215)
        if not self._overview:
            self.apply_layout()

    def update_empty_state(self):
        self.empty_label.setVisible(len(self.panes) == 0)
        count = len(self.panes)
        self.count_label.setText(
            "No documents loaded" if count == 0 else
            f"{count} document{'s' if count != 1 else ''} loaded"
        )

    def handle_scroll(self, source_pane: PdfPane, _value: int):
        if not self.sync_checkbox.isChecked() or self._syncing:
            return
        self._syncing = True
        fraction = source_pane.scroll_fraction()
        for pane in self.panes:
            if pane is not source_pane:
                pane.set_scroll_fraction(fraction)
        QTimer.singleShot(0, lambda: setattr(self, "_syncing", False))

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        paths = [url.toLocalFile() for url in event.mimeData().urls()]
        self.load_files(paths)


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    if len(sys.argv) > 1:
        window.load_files(sys.argv[1:])
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
