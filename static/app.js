const state = { docs: [], syncing: false, overview: false, zipNames: [] };
const panels = document.querySelector('#panels');
const dropzone = document.querySelector('#dropzone');
const emptyState = document.querySelector('#emptyState');
const fileInput = document.querySelector('#fileInput');
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
let expandedPanel = null;
let focusedFolder = null;

function setExpanded(panel, expand) {
  if (expand && expandedPanel && expandedPanel !== panel) setExpanded(expandedPanel, false);
  panel.classList.toggle('expanded', expand);
  expandedPanel = expand ? panel : null;
  expandBackdrop.hidden = !expand && !focusedFolder;
  const fullscreenButton = panel.querySelector('.fullscreen-button');
  if (fullscreenButton) {
    fullscreenButton.textContent = expand ? '⊟' : '⛶';
    fullscreenButton.title = expand ? 'Exit full screen (Esc)' : 'View full screen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-expanded', String(expand));
  }
  const removeButton = panel.querySelector('.remove-button');
  if (removeButton) removeButton.title = expand ? 'Close enlarged view' : removeButton.dataset.defaultTitle;
}
function closeFolderFocus() {
  if (!focusedFolder) return;
  const { filesContainer, trigger } = focusedFolder;
  [...folderFocusFiles.querySelectorAll(':scope > .panel')].forEach(panel => filesContainer.append(panel));
  folderFocusEl.hidden = true;
  focusedFolder = null;
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
expandBackdrop.addEventListener('click', () => { if (expandedPanel) setExpanded(expandedPanel, false); closeFolderFocus(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (expandedPanel) setExpanded(expandedPanel, false);
  closeFolderFocus();
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
function addButton(label, action, title) {
  const button = document.createElement('button');
  button.className = 'icon-button'; button.textContent = label; button.title = title; button.addEventListener('click', action);
  return button;
}
function makeFullscreenButton(panel) {
  const button = addButton('⛶', () => setExpanded(panel, !panel.classList.contains('expanded')), 'View full screen');
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
function makeRemoveButton(panel, doc, title) {
  const button = addButton('×', () => {
    if (panel.classList.contains('expanded')) { setExpanded(panel, false); return; }
    removeDoc(doc.id);
  }, title);
  button.classList.add('remove-button');
  button.dataset.defaultTitle = title;
  return button;
}
function enableExpandOnDoubleClick(body, panel) {
  body.addEventListener('dblclick', event => {
    if (event.target.closest('button, a, input')) return;
    setExpanded(panel, !panel.classList.contains('expanded'));
  });
}
function enablePanning(body) {
  let panning = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  body.addEventListener('mousedown', event => {
    if (event.button !== 0 || !body.classList.contains('zoomed')) return;
    if (event.target.closest('button, a, input')) return;
    panning = true;
    startX = event.clientX; startY = event.clientY;
    startLeft = body.scrollLeft; startTop = body.scrollTop;
    body.classList.add('panning');
    event.preventDefault();
  });
  window.addEventListener('mousemove', event => {
    if (!panning) return;
    body.scrollLeft = startLeft - (event.clientX - startX);
    body.scrollTop = startTop - (event.clientY - startY);
  });
  window.addEventListener('mouseup', () => { if (panning) { panning = false; body.classList.remove('panning'); } });
}
function centerEdges(container, axis) {
  if (!container) return;
  const items = [...container.querySelectorAll(':scope > .panel, :scope > .folder-group')];
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
function addNextFileButton(doc, body) {
  if (!doc.folder) return;
  const wrap = document.createElement('div'); wrap.className = 'next-file-wrap';
  const button = document.createElement('button'); button.className = 'next-file-button'; button.textContent = 'Next file →';
  button.addEventListener('click', () => {
    const panel = body.closest('.panel');
    const container = panel?.parentElement;
    if (!panel || !container) return;
    const siblings = [...container.querySelectorAll(':scope > .panel')];
    const nextPanel = siblings[siblings.indexOf(panel) + 1];
    if (!nextPanel) { notify('This is the last file in this app.'); return; }
    setExpanded(panel, false);
    setExpanded(nextPanel, true);
    nextPanel.querySelector('.panel-body')?.scrollTo({ top: 0, left: 0 });
  });
  wrap.append(button);
  body.append(wrap);
}
function recalcCentering() {
  centerEdges(panels, 'x');
  document.querySelectorAll('.folder-files').forEach(el => centerEdges(el, 'y'));
  if (!folderFocusEl.hidden) centerEdges(folderFocusFiles, 'x');
}
function renderDoc(doc, target = panels) {
  const panel = document.createElement('article');
  panel.className = 'panel'; panel.dataset.id = doc.id;
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
    addNextFileButton(doc, body);
    header.append(addButton('←', () => moveDoc(doc.id, -1), 'Move file left'), addButton('→', () => moveDoc(doc.id, 1), 'Move file right'), title, meta, addButton('−', () => setSheetZoom(-10), 'Zoom out'), sheetZoom, addButton('+', () => setSheetZoom(10), 'Zoom in'), addDownloadLink(doc), makeFullscreenButton(panel), makeRemoveButton(panel, doc, 'Remove file'));
    panel.append(header, body); target.append(panel); return;
  }
  const pageImages = [];
  for (let pageNumber = 0; pageNumber < doc.page_count; pageNumber += 1) {
    const image = document.createElement('img');
    image.className = 'page-image'; image.alt = `${doc.name}, page ${pageNumber + 1}`; image.loading = 'lazy';
    image.src = `/api/documents/${doc.id}/pages/${pageNumber}`;
    body.append(image); pageImages.push(image);
  }
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
  addNextFileButton(doc, body);
  header.append(addButton('←', () => moveDoc(doc.id, -1), 'Move PDF left'), addButton('→', () => moveDoc(doc.id, 1), 'Move PDF right'), title, meta, addButton('−', () => setZoom(-10), 'Zoom out'), zoom, addButton('+', () => setZoom(10), 'Zoom in'), addDownloadLink(doc), makeFullscreenButton(panel), makeRemoveButton(panel, doc, 'Remove PDF'));
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
  const syncLabel = document.createElement('label'); syncLabel.className = 'check'; syncLabel.title = `Sync scrolling between ${folder.name}'s files`;
  const syncInput = document.createElement('input'); syncInput.type = 'checkbox';
  syncInput.addEventListener('change', () => {
    group.classList.toggle('sync-on', syncInput.checked);
    if (focusedFolder?.group === group) folderFocusSync.checked = syncInput.checked;
  });
  syncLabel.append(syncInput, document.createTextNode('Sync'));
  group._syncInput = syncInput;
  const fullscreenButton = addButton('⛶', () => toggleFolderFocus(group, fullscreenButton), `View ${folder.name} full screen`);
  fullscreenButton.classList.add('folder-fullscreen-button');
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
  const right = document.createElement('div'); right.className = 'folder-header-right';
  right.append(folderCount, syncLabel, fullscreenButton);
  heading.append(left, right);
  const files = document.createElement('div'); files.className = 'folder-files';
  group.append(heading, files); panels.append(group);
  folder.documents.forEach(doc => renderDoc(doc, files));
}
function renderArchiveFolders(folders) {
  const appOrder = ['artifacts', 'capital_one_cards', 'cash_app_p2p', 'experian', 'irs_gov', 'navy_federal_cu', 'rocket_mortgage'];
  folders
    .sort((left, right) => {
      const leftIndex = appOrder.indexOf(left.name);
      const rightIndex = appOrder.indexOf(right.name);
      return (leftIndex < 0 ? appOrder.length : leftIndex) - (rightIndex < 0 ? appOrder.length : rightIndex);
    })
    .forEach(renderFolder);
}
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
      const notice = document.createElement('p'); notice.className = 'sheet-truncated';
      notice.textContent = `Showing first ${sheet.rows.length.toLocaleString()} of ${sheet.total_rows.toLocaleString()} rows — download the file to see the rest.`;
      section.append(notice);
    }
    body.append(section);
  });
}
function applyLayout() {
  if (state.overview) { recalcCentering(); return; }
  const count = Math.max(1, state.docs.length);
  panels.querySelectorAll(':scope > .panel').forEach(panel => { panel.style.flex = ''; panel.style.minWidth = ''; });
  if (layoutSelect.value === 'fixed') {
    panels.querySelectorAll(':scope > .panel').forEach(panel => { panel.style.flex = '0 0 clamp(320px, 42vw, 620px)'; });
  } else if (layoutSelect.value === 'equal') {
    const width = Math.max(280, Math.floor(window.innerWidth / Math.min(count, 4)));
    panels.querySelectorAll(':scope > .panel').forEach(panel => { panel.style.flex = `0 0 ${width}px`; panel.style.minWidth = `${width}px`; });
  } else {
    const width = Math.max(320, Math.min(560, Math.floor((window.innerWidth - 40) / 3)));
    panels.querySelectorAll(':scope > .panel').forEach(panel => { panel.style.flex = `0 0 ${width}px`; panel.style.minWidth = `${width}px`; });
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
}
async function removeDoc(id) {
  const doc = state.docs.find(candidate => candidate.id === id);
  await fetch(`/api/documents/${id}`, { method: 'DELETE' });
  state.docs = state.docs.filter(candidate => candidate.id !== id);
  const panel = document.querySelector(`[data-id="${id}"]`);
  if (panel === expandedPanel) setExpanded(panel, false);
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
async function uploadFiles(fileList) {
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      const archiveForm = new FormData(); archiveForm.append('file', file);
      const archiveResponse = await fetch('/api/archive', { method: 'POST', body: archiveForm });
      if (!archiveResponse.ok) { notify((await archiveResponse.json()).detail || 'ZIP upload failed'); continue; }
      const archive = await archiveResponse.json(); renderArchiveFolders(archive.folders);
      archive.folders.forEach(folder => folder.documents.forEach(doc => state.docs.push(doc)));
      state.zipNames.push(file.name);
      continue;
    }
    if (!/\.(pdf|xlsx|csv)$/i.test(file.name)) { notify(`${file.name} is not a supported file`); continue; }
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/documents', { method: 'POST', body: form });
    if (!response.ok) { notify((await response.json()).detail || 'Upload failed'); continue; }
    const doc = await response.json(); state.docs.push(doc); renderDoc(doc);
  }
  updateState(); applyLayout();
}
document.querySelector('#addButton').onclick = () => fileInput.click();
document.querySelector('#emptyAddButton').onclick = () => fileInput.click();
document.querySelector('#clearButton').onclick = async () => { await Promise.all(state.docs.map(doc => fetch(`/api/documents/${doc.id}`, { method: 'DELETE' }))); state.docs = []; state.zipNames = []; panels.replaceChildren(); updateState(); recalcCentering(); };
document.querySelector('#overviewButton').onclick = toggleOverview;
fileInput.onchange = () => uploadFiles(fileInput.files);
layoutSelect.onchange = applyLayout;
window.addEventListener('resize', applyLayout);
let scrollSource = null;
document.addEventListener('scroll', event => {
  const body = event.target;
  if (!body.classList?.contains('panel-body') || scrollSource) return;
  const inFocusFiles = folderFocusFiles.contains(body);
  const group = inFocusFiles ? focusedFolder?.group : body.closest('.folder-group');
  const folderSyncOn = group?.classList.contains('sync-on');
  if (!syncCheck.checked && !folderSyncOn) return;
  scrollSource = body;
  const ratio = body.scrollTop / Math.max(1, body.scrollHeight - body.clientHeight);
  const targets = syncCheck.checked
    ? document.querySelectorAll('.panel-body')
    : inFocusFiles
      ? folderFocusFiles.querySelectorAll('.panel .panel-body')
      : group.querySelectorAll('.folder-files .panel .panel-body');
  targets.forEach(other => { if (other !== body) other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight); });
  requestAnimationFrame(() => { scrollSource = null; });
}, true);
// A trackpad's two-finger scroll is vertical-dominant and just falls through
// to the hovered panel's own scrolling (native, no code needed here). A
// sideways swipe is horizontal-dominant: if the panel you're over still has
// its own horizontal scrolling left to do (e.g. a wide CSV table with
// columns off-screen), that takes priority so nothing gets stuck looking
// "cut off". Only once that panel is scrolled all the way to that edge --
// or you explicitly hold Shift, which always means "scroll the row" -- do
// we redirect the gesture to scroll the whole row of panels/folders instead.
panels.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) return; // reserved for per-document zoom
  const body = event.target.closest('.panel-body');
  if (!body) return;
  if (event.shiftKey) {
    event.preventDefault();
    panels.scrollLeft += event.deltaY;
    return;
  }
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  const atLeftEdge = body.scrollLeft <= 0;
  const atRightEdge = body.scrollLeft + body.clientWidth >= body.scrollWidth - 1;
  const exhausted = (event.deltaX < 0 && atLeftEdge) || (event.deltaX > 0 && atRightEdge);
  if (!exhausted) return; // let the panel's own horizontal scroll happen natively
  event.preventDefault();
  panels.scrollLeft += event.deltaX;
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
dropzone.addEventListener('drop', event => uploadFiles(event.dataTransfer.files));
document.addEventListener('paste', event => {
  const files = event.clipboardData?.files;
  if (!files || !files.length) return;
  event.preventDefault();
  notify(`Pasted ${files.length} file${files.length === 1 ? '' : 's'}`);
  uploadFiles(files);
});
updateState();
