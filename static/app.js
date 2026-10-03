const state = { docs: [], syncing: false, overview: false, zipNames: [] };
const panels = document.querySelector('#panels');
const dropzone = document.querySelector('#dropzone');
const emptyState = document.querySelector('#emptyState');
const fileInput = document.querySelector('#fileInput');
const folderInput = document.querySelector('#folderInput');
const countLabel = document.querySelector('#countLabel');
const layoutSelect = document.querySelector('#layoutSelect');
const syncCheck = document.querySelector('#syncCheck');
const toast = document.querySelector('#toast');
const expandBackdrop = document.querySelector('#expandBackdrop');
const folderFocusEl = document.querySelector('#folderFocus');
const folderFocusTitle = document.querySelector('#folderFocusTitle');
const folderFocusCount = document.querySelector('#folderFocusCount');
const folderFocusFiles = document.querySelector('#folderFocusFiles');
const folderFocusSync = document.querySelector('#folderFocusSync');
const folderIndex = document.querySelector('#folderIndex');
const qaReportButton = document.querySelector('#qaReportButton');
const qaReportModal = document.querySelector('#qaReportModal');
const qaReportModalBody = document.querySelector('#qaReportModalBody');
const qaReportClose = document.querySelector('#qaReportClose');
let latestQaReport = null;
let expandedPanel = null;
let focusedFolder = null;

function setExpanded(panel, expand) {
  if (expand && expandedPanel && expandedPanel !== panel) setExpanded(expandedPanel, false);
  panel.classList.toggle('expanded', expand);
  expandedPanel = expand ? panel : null;
  expandBackdrop.hidden = !expand && !focusedFolder;
  const fullscreenButton = panel.querySelector('.fullscreen-button');
  if (fullscreenButton) {
    fullscreenButton.innerHTML = expand ? COLLAPSE_ICON_SVG : EXPAND_ICON_SVG;
    fullscreenButton.title = expand ? 'Exit full screen (Esc)' : 'View full screen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-expanded', String(expand));
  }
  const removeButton = panel.querySelector('.remove-button');
  if (removeButton) removeButton.title = expand ? 'Close enlarged view' : removeButton.dataset.defaultTitle;
}
function setFolderIndexCurrent(folderName, current) {
  if (!folderName) return;
  folderIndex.querySelector(`.folder-index-item[data-folder="${CSS.escape(folderName)}"]`)?.classList.toggle('current', current);
}
function closeFolderFocus() {
  if (!focusedFolder) return;
  const { filesContainer, trigger, group } = focusedFolder;
  [...folderFocusFiles.querySelectorAll(':scope > .panel')].forEach(panel => filesContainer.append(panel));
  folderFocusEl.hidden = true;
  focusedFolder = null;
  setFolderIndexCurrent(group.dataset.folder, false);
  expandBackdrop.hidden = !expandedPanel;
  trigger?.focus();
  recalcCentering();
}
function openFolderFocus(group, trigger = null) {
  if (expandedPanel) setExpanded(expandedPanel, false);
  const filesContainer = group.querySelector('.folder-files');
  const order = [...filesContainer.querySelectorAll(':scope > .panel')];
  if (!order.length) return;
  focusedFolder = { group, filesContainer, trigger };
  folderFocusTitle.textContent = group.querySelector('.folder-header strong').textContent;
  folderFocusCount.textContent = `${order.length} file${order.length === 1 ? '' : 's'}`;
  order.forEach(panel => folderFocusFiles.append(panel));
  folderFocusSync.checked = group.classList.contains('sync-on');
  folderFocusEl.hidden = false;
  expandBackdrop.hidden = false;
  setFolderIndexCurrent(group.dataset.folder, true);
  document.querySelector('#folderFocusClose').focus();
  recalcCentering();
}
folderFocusSync.addEventListener('change', () => {
  if (!focusedFolder) return;
  focusedFolder.group.classList.toggle('sync-on', folderFocusSync.checked);
  if (focusedFolder.group._syncInput) focusedFolder.group._syncInput.checked = folderFocusSync.checked;
});
function toggleFolderFocus(group, trigger = null) {
  if (focusedFolder) { const wasThisGroup = focusedFolder.group === group; closeFolderFocus(); if (wasThisGroup) return; }
  openFolderFocus(group, trigger);
}
document.querySelector('#folderFocusClose').addEventListener('click', closeFolderFocus);
expandBackdrop.addEventListener('click', () => { if (expandedPanel) setExpanded(expandedPanel, false); closeFolderFocus(); closeQaReportModal(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (expandedPanel) setExpanded(expandedPanel, false);
    closeFolderFocus();
    closeQaReportModal();
    return;
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (!expandedPanel) return;
  if (event.target.closest('input, select, textarea')) return;
  event.preventDefault();
  goToSiblingFile(expandedPanel, event.key === 'ArrowLeft' ? -1 : 1);
});

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}
function updateState() {
  const count = state.docs.length;
  emptyState.hidden = count > 0;
  panels.hidden = count === 0;
  const zipSuffix = state.zipNames.length ? ` — from ${state.zipNames.join(', ')}` : '';
  countLabel.textContent = count ? `${count} document${count === 1 ? '' : 's'} loaded${zipSuffix}` : 'No documents loaded';
}
function addButton(svg, action, title) {
  const button = document.createElement('button');
  button.className = 'icon-button'; button.innerHTML = svg; button.title = title; button.addEventListener('click', action);
  return button;
}
const EXPAND_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const COLLAPSE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
const CLOSE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const SUN_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const MOON_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const MINUS_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const PLUS_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const CHEVRON_LEFT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const CHEVRON_RIGHT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const DOUBLE_CHEVRON_LEFT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 17 13 12 18 7"/><polyline points="11 17 6 12 11 7"/></svg>';
const DOUBLE_CHEVRON_RIGHT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 17 11 12 6 7"/><polyline points="13 17 18 12 13 7"/></svg>';
function makeFullscreenButton(panel) {
  const button = addButton(EXPAND_ICON_SVG, () => setExpanded(panel, !panel.classList.contains('expanded')), 'View full screen');
  button.classList.add('fullscreen-button');
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-expanded', 'false');
  return button;
}
const DOWNLOAD_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
function addDownloadLink(doc) {
  const link = document.createElement('a');
  link.className = 'icon-button'; link.innerHTML = DOWNLOAD_ICON_SVG; link.title = `Download ${doc.name}`;
  link.href = `/api/documents/${doc.id}`; link.download = doc.name; link.rel = 'noopener';
  return link;
}
const COPY_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ROTATE_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
function makeRotateButton(onRotate, title) {
  const button = document.createElement('button');
  button.className = 'icon-button'; button.innerHTML = ROTATE_ICON_SVG; button.title = title;
  button.addEventListener('click', onRotate);
  return button;
}
function makeCopyTextButton(doc) {
  const button = document.createElement('button');
  button.className = 'icon-button'; button.innerHTML = COPY_ICON_SVG; button.title = `Copy text from ${doc.name}`;
  button.addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/documents/${doc.id}/text`);
      if (!response.ok) throw new Error((await response.json()).detail || 'Could not extract text');
      const { text } = await response.json();
      if (!text.trim()) { notify('No selectable text found in this PDF.'); return; }
      await navigator.clipboard.writeText(text);
      notify('PDF text copied to clipboard.');
    } catch (error) {
      notify(error.message || 'Could not copy text.');
    }
  });
  return button;
}
function makeRemoveButton(panel, doc, title) {
  const button = addButton(CLOSE_ICON_SVG, () => {
    if (panel.classList.contains('expanded')) { setExpanded(panel, false); return; }
    removeDoc(doc.id);
  }, title);
  button.classList.add('remove-button');
  button.dataset.defaultTitle = title;
  return button;
}
function scrollSheetByColumn(body, direction) {
  const tables = [...body.querySelectorAll('table')];
  if (!tables.length) { body.scrollBy({ left: direction * 240, behavior: 'smooth' }); return; }
  const bodyRect = body.getBoundingClientRect();
  const table = tables.find(candidate => {
    const rect = candidate.getBoundingClientRect();
    return rect.bottom > bodyRect.top && rect.top < bodyRect.bottom;
  }) || tables[0];
  const headerRow = table.rows[0];
  if (!headerRow) { body.scrollBy({ left: direction * 240, behavior: 'smooth' }); return; }
  const boundaries = [...headerRow.cells].map(cell => cell.getBoundingClientRect().left - bodyRect.left + body.scrollLeft);
  const current = Math.round(body.scrollLeft);
  if (direction > 0) {
    const next = boundaries.find(left => left > current + 1);
    body.scrollTo({ left: next !== undefined ? next : body.scrollWidth, behavior: 'smooth' });
  } else {
    const previous = boundaries.filter(left => left < current - 1);
    body.scrollTo({ left: previous.length ? previous[previous.length - 1] : 0, behavior: 'smooth' });
  }
}
function enableExpandOnDoubleClick(body, panel) {
  body.addEventListener('dblclick', event => {
    if (event.target.closest('button, a, input')) return;
    setExpanded(panel, !panel.classList.contains('expanded'));
  });
}
function enablePanning(body) {
  let panning = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  // mousemove/mouseup have to live on window (dragging can leave the panel),
  // so they must be torn down explicitly when the panel goes away -- an
  // AbortController lets removeDoc/clearButton do that in one call instead
  // of these listeners piling up on window for the rest of the session.
  const panAbort = new AbortController();
  body._panAbort = panAbort;
  body.addEventListener('mousedown', event => {
    if (event.button !== 0 || !body.classList.contains('zoomed')) return;
    if (event.target.closest('button, a, input')) return;
    panning = true;
    startX = event.clientX; startY = event.clientY;
    startLeft = body.scrollLeft; startTop = body.scrollTop;
    body.classList.add('panning');
    event.preventDefault();
  }, { signal: panAbort.signal });
  window.addEventListener('mousemove', event => {
    if (!panning) return;
    body.scrollLeft = startLeft - (event.clientX - startX);
    body.scrollTop = startTop - (event.clientY - startY);
  }, { signal: panAbort.signal });
  window.addEventListener('mouseup', () => { if (panning) { panning = false; body.classList.remove('panning'); } }, { signal: panAbort.signal });
}
function centerEdges(container, axis) {
  if (!container) return;
  const items = [...container.querySelectorAll(':scope > .panel:not([hidden]), :scope > .folder-group:not([hidden])')];
  const basePad = axis === 'x' ? 4 : 12;
  if (!items.length) {
    if (axis === 'x') { container.style.paddingLeft = `${basePad}px`; container.style.paddingRight = `${basePad}px`; }
    else { container.style.paddingTop = `${basePad}px`; container.style.paddingBottom = `${basePad}px`; }
    return;
  }
  const containerSize = axis === 'x' ? container.clientWidth : container.clientHeight;
  const itemRect = items[0].getBoundingClientRect();
  const itemSize = axis === 'x' ? itemRect.width : itemRect.height;
  const pad = Math.max(basePad, Math.round((containerSize - itemSize) / 2));
  if (axis === 'x') { container.style.paddingLeft = `${pad}px`; container.style.paddingRight = `${pad}px`; }
  else { container.style.paddingTop = `${pad}px`; container.style.paddingBottom = `${pad}px`; }
}
function goToSiblingFile(panel, direction) {
  const container = panel?.parentElement;
  if (!panel || !container) return;
  const siblings = [...container.querySelectorAll(':scope > .panel')];
  const target = siblings[siblings.indexOf(panel) + direction];
  if (!target) { notify(direction < 0 ? 'This is the first file.' : 'This is the last file.'); return; }
  setExpanded(panel, false);
  setExpanded(target, true);
  target.querySelector('.panel-body')?.scrollTo({ top: 0, left: 0 });
}
function addFileNavArrows(panel) {
  const left = document.createElement('button');
  left.className = 'nav-arrow nav-arrow-left'; left.innerHTML = CHEVRON_LEFT_ICON_SVG; left.title = 'Previous file';
  left.addEventListener('click', () => goToSiblingFile(panel, -1));
  const right = document.createElement('button');
  right.className = 'nav-arrow nav-arrow-right'; right.innerHTML = CHEVRON_RIGHT_ICON_SVG; right.title = 'Next file';
  right.addEventListener('click', () => goToSiblingFile(panel, 1));
  panel.append(left, right);
}
function recalcCentering() {
  centerEdges(panels, 'x');
  document.querySelectorAll('.folder-files').forEach(el => centerEdges(el, 'y'));
  if (!folderFocusEl.hidden) centerEdges(folderFocusFiles, 'x');
}
function renderDoc(doc, target = panels) {
  const panel = document.createElement('article');
  panel.className = 'panel'; panel.dataset.id = doc.id; panel.dataset.kind = doc.kind;
  const header = document.createElement('header'); header.className = 'panel-header';
  const title = document.createElement('strong'); title.className = 'panel-title'; title.textContent = doc.name; title.title = `${doc.name} — double-click to enlarge`;
  title.addEventListener('dblclick', () => setExpanded(panel, !panel.classList.contains('expanded')));
  const meta = document.createElement('span'); meta.className = 'panel-meta'; meta.textContent = doc.kind.toUpperCase();
  const zoom = document.createElement('span'); zoom.className = 'zoom-label'; zoom.textContent = '100%'; zoom.title = 'Reset zoom';
  const body = document.createElement('div'); body.className = 'panel-body';
  if (doc.kind !== 'pdf') {
    body.classList.add('spreadsheet-body');
    body.style.setProperty('--sheet-zoom', '1');
    const sheetZoom = document.createElement('span'); sheetZoom.className = 'zoom-label'; sheetZoom.textContent = '100%'; sheetZoom.title = 'Reset zoom';
    const setSheetZoom = (amount) => {
      const value = Math.max(75, Math.min(200, Number(sheetZoom.textContent.slice(0, -1)) + amount));
      sheetZoom.textContent = `${value}%`;
      body.style.setProperty('--sheet-zoom', String(value / 100));
      body.classList.toggle('zoomed', value > 100);
    };
    sheetZoom.addEventListener('click', () => { sheetZoom.textContent = '100%'; body.style.setProperty('--sheet-zoom', '1'); body.classList.remove('zoomed'); });
    body.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setSheetZoom(event.deltaY < 0 ? 2 : -2);
    }, { passive: false });
    enableExpandOnDoubleClick(body, panel);
    enablePanning(body);
    renderSpreadsheet(doc, body);
    addFileNavArrows(panel);
    header.append(addButton(CHEVRON_LEFT_ICON_SVG, () => moveDoc(doc.id, -1), 'Move file left'), addButton(CHEVRON_RIGHT_ICON_SVG, () => moveDoc(doc.id, 1), 'Move file right'), title, meta, addButton(DOUBLE_CHEVRON_LEFT_ICON_SVG, () => scrollSheetByColumn(body, -1), 'Scroll table left'), addButton(DOUBLE_CHEVRON_RIGHT_ICON_SVG, () => scrollSheetByColumn(body, 1), 'Scroll table right'), addButton(MINUS_ICON_SVG, () => setSheetZoom(-10), 'Zoom out'), sheetZoom, addButton(PLUS_ICON_SVG, () => setSheetZoom(10), 'Zoom in'), addDownloadLink(doc), makeFullscreenButton(panel), makeRemoveButton(panel, doc, 'Remove file'));
    panel.append(header, body); target.append(panel); return;
  }
  let rotation = 0;
  const pageImages = [];
  for (let pageNumber = 0; pageNumber < doc.page_count; pageNumber += 1) {
    const image = document.createElement('img');
    image.className = 'page-image'; image.alt = `${doc.name}, page ${pageNumber + 1}`; image.loading = 'lazy';
    image.src = `/api/documents/${doc.id}/pages/${pageNumber}?rotation=${rotation}`;
    body.append(image); pageImages.push(image);
  }
  const rotatePages = () => {
    rotation = (rotation + 90) % 360;
    pageImages.forEach((image, pageNumber) => { image.src = `/api/documents/${doc.id}/pages/${pageNumber}?rotation=${rotation}`; });
  };
  const setZoom = (amount) => {
    const value = Math.max(75, Math.min(250, Number(zoom.textContent.slice(0, -1)) + amount));
    zoom.textContent = `${value}%`;
    pageImages.forEach(image => { image.style.width = `${value}%`; });
    const wasZoomed = body.classList.contains('zoomed');
    body.classList.toggle('zoomed', value > 100);
    if (value > 100 && !wasZoomed) body.scrollLeft = (body.scrollWidth - body.clientWidth) / 2;
  };
  zoom.addEventListener('click', () => {
    zoom.textContent = '100%';
    pageImages.forEach(image => { image.style.width = '100%'; });
    body.classList.remove('zoomed');
  });
  body.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(event.deltaY < 0 ? 2 : -2);
  }, { passive: false });
  enableExpandOnDoubleClick(body, panel);
  enablePanning(body);
  addFileNavArrows(panel);
  header.append(addButton(CHEVRON_LEFT_ICON_SVG, () => moveDoc(doc.id, -1), 'Move PDF left'), addButton(CHEVRON_RIGHT_ICON_SVG, () => moveDoc(doc.id, 1), 'Move PDF right'), title, meta, addButton(MINUS_ICON_SVG, () => setZoom(-10), 'Zoom out'), zoom, addButton(PLUS_ICON_SVG, () => setZoom(10), 'Zoom in'), makeRotateButton(rotatePages, 'Rotate pages 90°'), makeCopyTextButton(doc), addDownloadLink(doc), makeFullscreenButton(panel), makeRemoveButton(panel, doc, 'Remove PDF'));
  panel.append(header, body); target.append(panel);
}
const REVIEW_STORAGE_KEY = 'pdfCompareReviewStatus';
function loadReviewStatus() {
  try { return JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY)) || {}; } catch { return {}; }
}
function setFolderReview(folderName, correctBtn, wrongBtn, clicked) {
  const status = loadReviewStatus();
  const value = status[folderName] === clicked ? null : clicked;
  if (value) status[folderName] = value; else delete status[folderName];
  try { localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(status)); } catch {}
  correctBtn.classList.toggle('active', value === 'correct');
  wrongBtn.classList.toggle('active', value === 'wrong');
}
function renderFolder(folder) {
  const group = document.createElement('section'); group.className = 'folder-group';
  group.dataset.folder = folder.name;
  const heading = document.createElement('header'); heading.className = 'folder-header';
  const folderName = document.createElement('strong'); folderName.textContent = folder.name;
  folderName.title = `${folder.name} — double-click to view all files side by side`;
  folderName.addEventListener('dblclick', () => toggleFolderFocus(group));
  const correctBtn = document.createElement('button'); correctBtn.className = 'review-btn correct'; correctBtn.textContent = '✓'; correctBtn.title = 'Mark this app reviewed: correct';
  const wrongBtn = document.createElement('button'); wrongBtn.className = 'review-btn wrong'; wrongBtn.textContent = '✗'; wrongBtn.title = 'Mark this app reviewed: incorrect';
  correctBtn.addEventListener('click', () => setFolderReview(folder.name, correctBtn, wrongBtn, 'correct'));
  wrongBtn.addEventListener('click', () => setFolderReview(folder.name, correctBtn, wrongBtn, 'wrong'));
  const savedStatus = loadReviewStatus()[folder.name];
  correctBtn.classList.toggle('active', savedStatus === 'correct');
  wrongBtn.classList.toggle('active', savedStatus === 'wrong');
  const reviewGroup = document.createElement('div'); reviewGroup.className = 'review-group';
  reviewGroup.append(correctBtn, wrongBtn);
  const left = document.createElement('div'); left.className = 'folder-header-left';
  left.append(folderName, reviewGroup);
  const folderCount = document.createElement('span'); folderCount.textContent = `${folder.documents.length} file${folder.documents.length === 1 ? '' : 's'}`;
  const syncLabel = document.createElement('label'); syncLabel.className = 'switch switch-compact'; syncLabel.title = `Sync scrolling between ${folder.name}'s files`;
  const syncInput = document.createElement('input'); syncInput.type = 'checkbox';
  syncInput.addEventListener('change', () => {
    group.classList.toggle('sync-on', syncInput.checked);
    if (focusedFolder?.group === group) folderFocusSync.checked = syncInput.checked;
  });
  const syncTrack = document.createElement('span'); syncTrack.className = 'switch-track';
  const syncThumb = document.createElement('span'); syncThumb.className = 'switch-thumb';
  syncTrack.append(syncThumb);
  const syncTextLabel = document.createElement('span'); syncTextLabel.className = 'switch-label'; syncTextLabel.textContent = 'Sync';
  syncLabel.append(syncInput, syncTrack, syncTextLabel);
  group._syncInput = syncInput;
  const fullscreenButton = addButton(EXPAND_ICON_SVG, () => toggleFolderFocus(group, fullscreenButton), `View ${folder.name} full screen`);
  fullscreenButton.classList.add('folder-fullscreen-button');
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
  const right = document.createElement('div'); right.className = 'folder-header-right';
  right.append(folderCount, syncLabel, fullscreenButton);
  heading.append(left, right);
  // Building the whole group -- including every file panel and its page
  // images -- while it's still detached, and only attaching it to #panels
  // once fully populated, means those hundreds of appends never touch the
  // live document at all. Attaching each file panel as soon as its folder
  // was live (the previous behavior) forced the browser to do incremental
  // layout work on an already-connected subtree for every single one.
  const files = document.createElement('div'); files.className = 'folder-files';
  group.append(heading, files);
  folder.documents.forEach(doc => renderDoc(doc, files));
  return group;
}
function renderArchiveFolders(folders) {
  const appOrder = ['artifacts', 'capital_one_cards', 'cash_app_p2p', 'experian', 'irs_gov', 'navy_federal_cu', 'rocket_mortgage'];
  const fragment = document.createDocumentFragment();
  folders
    .sort((left, right) => {
      const leftIndex = appOrder.indexOf(left.name);
      const rightIndex = appOrder.indexOf(right.name);
      return (leftIndex < 0 ? appOrder.length : leftIndex) - (rightIndex < 0 ? appOrder.length : rightIndex);
    })
    .forEach(folder => fragment.append(renderFolder(folder)));
  panels.append(fragment);
}
function buildQaAppSection(appName, appData, checkLabels) {
  const section = document.createElement('div'); section.className = 'qa-app';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = `qa-app-header ${appData.passed ? 'qa-pass' : 'qa-fail'}`;
  header.setAttribute('aria-expanded', 'false');
  const dot = document.createElement('span'); dot.className = 'qa-dot';
  const title = document.createElement('span'); title.textContent = appName;
  const status = document.createElement('span');
  status.style.marginLeft = 'auto'; status.style.opacity = '.7'; status.style.fontWeight = '400';
  status.textContent = appData.passed ? 'All checks passed' : 'Issues found';
  const chevron = document.createElement('span'); chevron.className = 'qa-chevron'; chevron.textContent = '▾';
  header.append(dot, title, status, chevron);

  const body = document.createElement('div'); body.className = 'qa-app-body'; body.hidden = true;
  Object.entries(appData.checks).forEach(([key, result]) => {
    const checkSection = document.createElement('div'); checkSection.className = 'qa-check';
    const heading = document.createElement('h4');
    const badge = document.createElement('span');
    badge.className = `qa-check-badge ${result.passed ? 'qa-pass' : 'qa-fail'}`;
    badge.textContent = result.passed ? 'PASS' : 'FAIL';
    heading.append(badge, document.createTextNode(checkLabels[key] || key));
    checkSection.append(heading);
    (result.summary || []).forEach(line => {
      const p = document.createElement('p'); p.className = 'qa-summary-line'; p.textContent = line;
      checkSection.append(p);
    });
    if (result.findings.length) {
      const list = document.createElement('ul');
      result.findings.forEach(finding => { const item = document.createElement('li'); item.textContent = finding; list.append(item); });
      checkSection.append(list);
    }
    body.append(checkSection);
  });
  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
  });
  section.append(header, body);
  return section;
}
function renderQaReport(report) {
  latestQaReport = report;
  if (!report) { qaReportButton.hidden = true; closeQaReportModal(); return; }

  qaReportButton.hidden = false;
  qaReportButton.className = `ghost qa-report-button ${report.overall_passed ? 'qa-pass' : 'qa-fail'}`;
  qaReportButton.replaceChildren();
  const dot = document.createElement('span'); dot.className = 'qa-dot';
  qaReportButton.append(dot, document.createTextNode('QA Report'));

  qaReportModalBody.replaceChildren();
  const note = document.createElement('p'); note.className = 'qa-report-note'; note.textContent = report.note;
  qaReportModalBody.append(note);

  const overall = document.createElement('div');
  overall.className = `qa-report-overall ${report.overall_passed ? 'qa-pass' : 'qa-fail'}`;
  const appEntries = Object.entries(report.apps);
  const failedCount = appEntries.filter(([, data]) => !data.passed).length;
  overall.textContent = report.overall_passed
    ? `${report.decision}: all ${appEntries.length} app(s) passed every implemented check.`
    : `${report.decision}: ${failedCount} of ${appEntries.length} app(s) have issues.`;
  qaReportModalBody.append(overall);

  if (report.remediation && report.remediation.length) {
    const section = document.createElement('div'); section.className = 'qa-check';
    const heading = document.createElement('h4');
    const badge = document.createElement('span'); badge.className = 'qa-check-badge qa-fail'; badge.textContent = 'FIX';
    heading.append(badge, document.createTextNode('What to fix'));
    const list = document.createElement('ul');
    report.remediation.forEach(step => { const item = document.createElement('li'); item.textContent = step; list.append(item); });
    section.append(heading, list);
    qaReportModalBody.append(section);
  }

  if (report.submission_level_findings.length) {
    const section = document.createElement('div'); section.className = 'qa-check';
    const heading = document.createElement('h4');
    const badge = document.createElement('span'); badge.className = 'qa-check-badge qa-fail'; badge.textContent = 'FAIL';
    heading.append(badge, document.createTextNode('Submission-level'));
    const list = document.createElement('ul');
    report.submission_level_findings.forEach(finding => { const item = document.createElement('li'); item.textContent = finding; list.append(item); });
    section.append(heading, list);
    qaReportModalBody.append(section);
  }

  appEntries
    .sort(([, left], [, right]) => Number(left.passed) - Number(right.passed))
    .forEach(([appName, appData]) => qaReportModalBody.append(buildQaAppSection(appName, appData, report.check_labels)));
}
function openQaReportModal() {
  if (!latestQaReport) return;
  if (expandedPanel) setExpanded(expandedPanel, false);
  closeFolderFocus();
  qaReportModal.hidden = false;
  expandBackdrop.hidden = false;
  qaReportClose.focus();
}
function closeQaReportModal() {
  if (qaReportModal.hidden) return;
  qaReportModal.hidden = true;
  expandBackdrop.hidden = !expandedPanel && !focusedFolder;
}
qaReportButton.addEventListener('click', openQaReportModal);
qaReportClose.addEventListener('click', closeQaReportModal);
async function renderSpreadsheet(doc, body) {
  const response = await fetch(`/api/documents/${doc.id}/preview`);
  if (!response.ok) { body.textContent = 'Could not load spreadsheet preview.'; return; }
  const preview = await response.json();
  preview.sheets.forEach(sheet => {
    const section = document.createElement('section'); section.className = 'sheet';
    const heading = document.createElement('h3'); heading.textContent = sheet.name; section.append(heading);
    const table = document.createElement('table');
    sheet.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach(value => { const cell = document.createElement(rowIndex === 0 ? 'th' : 'td'); cell.textContent = value; tr.append(cell); });
      table.append(tr);
    });
    section.append(table);
    if (sheet.truncated) {
      // The backend stops reading as soon as it hits the preview cap rather
      // than scanning the rest of a large file just to report an exact
      // total, so there's always a "+" here instead of a known count.
      const notice = document.createElement('p'); notice.className = 'sheet-truncated';
      notice.textContent = `Showing first ${sheet.rows.length.toLocaleString()}+ rows — download the file to see the rest.`;
      section.append(notice);
    }
    body.append(section);
  });
}
function applyLayout() {
  if (state.overview) { recalcCentering(); return; }
  // A top-level "column" in the compare row is either a standalone document
  // panel or, once files come from a ZIP/folder, a whole .folder-group --
  // the layout dropdown needs to size whichever of those is actually a
  // direct child of #panels, not the individual file panels stacked inside
  // a folder-group (those size themselves vertically via their own CSS).
  const items = [...panels.querySelectorAll(':scope > .panel, :scope > .folder-group')];
  const count = Math.max(1, items.length);
  items.forEach(item => { item.style.flex = ''; item.style.width = ''; item.style.minWidth = ''; });
  if (layoutSelect.value === 'fixed') {
    items.forEach(item => { item.style.flex = '0 0 clamp(320px, 42vw, 620px)'; item.style.width = 'clamp(320px, 42vw, 620px)'; });
  } else if (layoutSelect.value === 'equal') {
    const width = Math.max(280, Math.floor(window.innerWidth / Math.min(count, 4)));
    items.forEach(item => { item.style.flex = `0 0 ${width}px`; item.style.width = `${width}px`; item.style.minWidth = `${width}px`; });
  } else {
    const width = Math.max(320, Math.min(560, Math.floor((window.innerWidth - 40) / 3)));
    items.forEach(item => { item.style.flex = `0 0 ${width}px`; item.style.width = `${width}px`; item.style.minWidth = `${width}px`; });
  }
  recalcCentering();
}
function moveDoc(id, direction) {
  const index = state.docs.findIndex(doc => doc.id === id);
  const folder = state.docs[index]?.folder;
  const folderIndexes = state.docs.map((doc, docIndex) => doc.folder === folder ? docIndex : -1).filter(docIndex => docIndex >= 0);
  const localIndex = folderIndexes.indexOf(index); const localTarget = localIndex + direction;
  if (localIndex < 0 || localTarget < 0 || localTarget >= folderIndexes.length) return;
  const target = folderIndexes[localTarget];
  [state.docs[index], state.docs[target]] = [state.docs[target], state.docs[index]];
  const panel = document.querySelector(`[data-id="${id}"]`);
  const container = panel.parentElement;
  const siblings = [...container.querySelectorAll(':scope > .panel')];
  const panelIndex = siblings.indexOf(panel);
  const siblingTarget = panelIndex + direction;
  if (siblingTarget < 0 || siblingTarget >= siblings.length) return;
  container.insertBefore(panel, direction < 0 ? siblings[siblingTarget] : siblings[siblingTarget].nextSibling);
}
function updateFolderCount(folderName) {
  const group = [...panels.querySelectorAll('.folder-group')].find(candidate => candidate.querySelector('.folder-header strong').textContent === folderName);
  if (!group) return;
  const inFocus = focusedFolder && focusedFolder.group === group;
  const filesContainer = inFocus ? folderFocusFiles : group.querySelector('.folder-files');
  const count = filesContainer.querySelectorAll(':scope > .panel').length;
  const label = `${count} file${count === 1 ? '' : 's'}`;
  group.querySelector('.folder-header span').textContent = label;
  if (inFocus) folderFocusCount.textContent = label;
  updateFolderIndex();
}
function updateFolderIndex() {
  const groups = [...panels.querySelectorAll(':scope > .folder-group')];
  if (!groups.length) { folderIndex.hidden = true; folderIndex.replaceChildren(); return; }
  folderIndex.hidden = false;
  folderIndex.replaceChildren(...groups.map(group => {
    const count = group.querySelectorAll(':scope > .folder-files > .panel').length;
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'folder-index-item'; item.dataset.folder = group.dataset.folder;
    item.title = `View ${group.dataset.folder}'s files side by side`;
    item.classList.toggle('current', focusedFolder?.group === group);
    const label = document.createElement('span'); label.textContent = group.dataset.folder;
    const badge = document.createElement('small'); badge.textContent = `${count}`;
    item.append(label, badge);
    item.addEventListener('click', () => toggleFolderFocus(group, item));
    return item;
  }));
}
async function removeDoc(id) {
  const doc = state.docs.find(candidate => candidate.id === id);
  await fetch(`/api/documents/${id}`, { method: 'DELETE' });
  state.docs = state.docs.filter(candidate => candidate.id !== id);
  const panel = document.querySelector(`[data-id="${id}"]`);
  if (panel === expandedPanel) setExpanded(panel, false);
  panel?.querySelector('.panel-body')?._panAbort?.abort();
  panel?.remove(); updateState();
  if (doc?.folder) updateFolderCount(doc.folder);
  recalcCentering();
}
function toggleOverview() {
  state.overview = !state.overview; panels.classList.toggle('overview-mode', state.overview);
  document.querySelector('#overviewButton').textContent = state.overview ? '⊟ Exit overview' : '⊞ Overview';
  panels.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('overview', state.overview));
  if (!state.overview) applyLayout();
}
// A folder the OS already extracted (rather than a .zip) arrives here as a
// flat list of File objects that each know their path *within* that folder
// -- via webkitRelativePath when picked through the folder input, or via
// _relativePath (set below) when dragged in and walked through the
// FileSystemEntry API. Anything with a nested path is grouped and sent as
// one batch to /api/folder, which mirrors /api/archive's folder-grouping
// logic so it renders through the exact same side-by-side folder view.
function getRelativePath(file) {
  return file.webkitRelativePath || file._relativePath || file.name;
}
async function uploadFolderEntries(entries) {
  const form = new FormData();
  entries.forEach(file => form.append('files', file, getRelativePath(file)));
  const response = await fetch('/api/folder', { method: 'POST', body: form });
  if (!response.ok) { notify((await response.json()).detail || 'Folder upload failed'); return; }
  const result = await response.json();
  renderArchiveFolders(result.folders);
  result.folders.forEach(folder => folder.documents.forEach(doc => state.docs.push(doc)));
  state.zipNames.push(getRelativePath(entries[0]).split('/')[0]);
}
async function uploadFiles(fileList) {
  const folderFiles = [];
  for (const file of fileList) {
    if (getRelativePath(file).includes('/')) { folderFiles.push(file); continue; }
    if (/\.zip$/i.test(file.name)) {
      const archiveForm = new FormData(); archiveForm.append('file', file);
      const archiveResponse = await fetch('/api/archive', { method: 'POST', body: archiveForm });
      if (!archiveResponse.ok) { notify((await archiveResponse.json()).detail || 'ZIP upload failed'); continue; }
      const archive = await archiveResponse.json(); renderArchiveFolders(archive.folders);
      archive.folders.forEach(folder => folder.documents.forEach(doc => state.docs.push(doc)));
      state.zipNames.push(file.name);
      renderQaReport(archive.qa_report);
      continue;
    }
    if (!/\.(pdf|xlsx|csv)$/i.test(file.name)) { notify(`${file.name} is not a supported file`); continue; }
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/documents', { method: 'POST', body: form });
    if (!response.ok) { notify((await response.json()).detail || 'Upload failed'); continue; }
    const doc = await response.json(); state.docs.push(doc); renderDoc(doc);
  }
  if (folderFiles.length) await uploadFolderEntries(folderFiles);
  updateState(); applyLayout(); updateFolderIndex();
}
function readEntryAsFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}
async function walkEntry(entry, basePath, out) {
  if (entry.isFile) {
    const file = await readEntryAsFile(entry);
    file._relativePath = basePath + entry.name;
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  let batch;
  do {
    batch = await readDirectoryBatch(reader);
    for (const child of batch) await walkEntry(child, `${basePath}${entry.name}/`, out);
  } while (batch.length);
}
async function filesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items ? [...dataTransfer.items] : [];
  // webkitGetAsEntry() must be called synchronously while handling the drop
  // event, before any await -- some browsers invalidate the DataTransfer
  // once the event handler's task finishes.
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const out = [];
  for (const entry of entries) await walkEntry(entry, '', out);
  return out;
}
document.querySelector('#addButton').onclick = () => fileInput.click();
document.querySelector('#emptyAddButton').onclick = () => fileInput.click();
document.querySelector('#addFolderButton').onclick = () => folderInput.click();
document.querySelector('#emptyAddFolderButton').onclick = () => folderInput.click();
document.querySelector('#clearButton').onclick = async () => {
  await Promise.all(state.docs.map(doc => fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })));
  panels.querySelectorAll('.panel-body').forEach(body => body._panAbort?.abort());
  state.docs = []; state.zipNames = []; panels.replaceChildren(); updateState(); recalcCentering(); updateFolderIndex();
  renderQaReport(null);
};
document.querySelector('#overviewButton').onclick = toggleOverview;
fileInput.onchange = () => uploadFiles(fileInput.files);
folderInput.onchange = () => uploadFiles(folderInput.files);
layoutSelect.onchange = applyLayout;
window.addEventListener('resize', applyLayout);
// Native scroll events fire far more often than once per frame (dozens of
// times per second during a trackpad drag), and each sync pass forces a
// layout read on every target panel -- doing that on every single event,
// unbatched, is what made sync scrolling feel stuck with many files open.
// Coalescing into one pass per animation frame keeps the reflow cost to at
// most 60/sec regardless of how fast events arrive. The echoes from our own
// `other.scrollTop = ...` writes are suppressed via Set membership rather
// than a timing-based flag, since the synthetic 'scroll' event for those
// writes isn't guaranteed to land inside the same frame we set them in.
let scrollSyncSource = null;
let scrollSyncFrame = null;
const programmaticScrolls = new Set();
document.addEventListener('scroll', event => {
  const body = event.target;
  if (!body.classList?.contains('panel-body')) return;
  if (programmaticScrolls.delete(body)) return;
  scrollSyncSource = body;
  if (scrollSyncFrame) return;
  scrollSyncFrame = requestAnimationFrame(() => {
    scrollSyncFrame = null;
    const source = scrollSyncSource;
    scrollSyncSource = null;
    if (!source) return;
    const inFocusFiles = folderFocusFiles.contains(source);
    const group = inFocusFiles ? focusedFolder?.group : source.closest('.folder-group');
    const folderSyncOn = group?.classList.contains('sync-on');
    if (!syncCheck.checked && !folderSyncOn) return;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    const targets = syncCheck.checked
      ? document.querySelectorAll('.panel-body')
      : inFocusFiles
        ? folderFocusFiles.querySelectorAll('.panel .panel-body')
        : group.querySelectorAll('.folder-files .panel .panel-body');
    targets.forEach(other => {
      if (other === source) return;
      programmaticScrolls.add(other);
      setTimeout(() => programmaticScrolls.delete(other), 100);
      other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight);
    });
  });
}, true);
// A trackpad's two-finger scroll is vertical-dominant and just falls through
// to the hovered panel's own scrolling (native, no code needed here). A
// sideways swipe is horizontal-dominant: if the panel you're over still has
// its own horizontal scrolling left to do (e.g. a wide CSV table with
// columns off-screen), that takes priority so nothing gets stuck looking
// "cut off". Only once that panel is scrolled all the way to that edge --
// or you explicitly hold Shift, which always means "scroll the row" -- do
// we redirect the gesture to scroll the whole row of panels/folders instead.
//
// A horizontal swipe fires dozens of wheel events per second, and reading
// scrollLeft/clientWidth/scrollWidth forces a layout flush -- doing that
// (plus a scrollLeft write) on every single event, unbatched, is what made
// this feel stuck with many panels/folders in the row. The edge check is
// cached per animation frame (refreshed once the accumulated scroll is
// flushed) so repeated events in the same frame reuse it instead of forcing
// a fresh reflow each time; only the scrollLeft write itself is deferred to
// the frame flush, since preventDefault must still be called synchronously
// per event to correctly suppress or allow that event's native scroll.
let panelsScrollFrame = null;
let panelsScrollDelta = 0;
let panelsEdgeCache = null;
function flushPanelsScroll() {
  panelsScrollFrame = null;
  panels.scrollLeft += panelsScrollDelta;
  panelsScrollDelta = 0;
  panelsEdgeCache = null;
}
panels.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) return; // reserved for per-document zoom
  const body = event.target.closest('.panel-body');
  if (!body) return;
  if (event.shiftKey) {
    event.preventDefault();
    panelsScrollDelta += event.deltaY;
    if (!panelsScrollFrame) panelsScrollFrame = requestAnimationFrame(flushPanelsScroll);
    return;
  }
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  if (!panelsEdgeCache || panelsEdgeCache.body !== body) {
    panelsEdgeCache = { body, atLeftEdge: body.scrollLeft <= 0, atRightEdge: body.scrollLeft + body.clientWidth >= body.scrollWidth - 1 };
  }
  const exhausted = (event.deltaX < 0 && panelsEdgeCache.atLeftEdge) || (event.deltaX > 0 && panelsEdgeCache.atRightEdge);
  if (!exhausted) return; // let the panel's own horizontal scroll happen natively
  event.preventDefault();
  panelsScrollDelta += event.deltaX;
  if (!panelsScrollFrame) panelsScrollFrame = requestAnimationFrame(flushPanelsScroll);
}, { passive: false });
document.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) return;
  if (!expandedPanel && !focusedFolder) return;
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.deltaX >= 0) return;
  const scrollEl = expandedPanel ? expandedPanel.querySelector('.panel-body') : folderFocusFiles;
  if (scrollEl && scrollEl.scrollLeft > 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (expandedPanel) { setExpanded(expandedPanel, false); return; }
  closeFolderFocus();
}, { capture: true, passive: false });
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('drag-over'); }));
dropzone.addEventListener('drop', event => { const dataTransfer = event.dataTransfer; filesFromDataTransfer(dataTransfer).then(uploadFiles); });
document.addEventListener('paste', event => {
  const clipboardData = event.clipboardData;
  if (!clipboardData || (!clipboardData.files?.length && !clipboardData.items?.length)) return;
  event.preventDefault();
  filesFromDataTransfer(clipboardData).then(files => {
    if (!files.length) { notify('No supported files found in the pasted item.'); return; }
    notify(`Pasted ${files.length} file${files.length === 1 ? '' : 's'}`);
    uploadFiles(files);
  });
});
const THEME_STORAGE_KEY = 'pdfCompareTheme';
const themeToggle = document.querySelector('#themeToggle');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.innerHTML = theme === 'dark' ? SUN_ICON_SVG : MOON_ICON_SVG;
  const title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.title = title;
  themeToggle.setAttribute('aria-label', title);
}
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
});
updateState();
