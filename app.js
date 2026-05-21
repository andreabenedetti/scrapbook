/* ============================================================
   DIARIO — app.js  (Supabase sync + PIN)
   ============================================================ */
"use strict";

// ── Config ─────────────────────────────────────────────────
const SUPABASE_URL = "https://nqlefjxvxnjesmwermzg.supabase.co";
const SUPABASE_KEY = "sb_publishable_JArvj4L0w8zelTi2T6iMPQ_Nq0H5P9B";
const CORRECT_PIN = "1916"; // lascia vuoto: viene impostato al primo accesso, oppure hardcodalo es. '1234'
const PIN_STORAGE_K = "diario_pin";

const CANVAS_W = 4000;
const CANVAS_H = 4000;
const ITEM_W_PHOTO = 180;
const COMPRESS_MAX = 900;
const COMPRESS_Q = 0.78;

// ── Supabase client ─────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ───────────────────────────────────────────────────
const state = {
  panX: 0,
  panY: 0,
  draggingItem: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  isDraggingItem: false,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panOriginX: 0,
  panOriginY: 0,
  longPressTimer: null,
  longPressItem: null,
  touchStartX: 0,
  touchStartY: 0,
  pendingPhotos: [],
  itemMap: {}, // id → DOM element
  zCounter: 10,
};

// ── DOM ─────────────────────────────────────────────────────
const pinScreen = document.getElementById("pin-screen");
const appEl = document.getElementById("app");
const canvasWrapper = document.getElementById("canvas-wrapper");
const canvas = document.getElementById("canvas");
const fab = document.getElementById("fab");
const panel = document.getElementById("panel");
const overlay = document.getElementById("overlay");
const panelClose = document.getElementById("panel-close");
const photoInput = document.getElementById("photo-input");
const photoDrop = document.getElementById("photo-drop");
const photoPreview = document.getElementById("photo-preview-list");
const photoConfirm = document.getElementById("photo-confirm");
const textInput = document.getElementById("text-input");
const textConfirm = document.getElementById("text-confirm");
const charCount = document.getElementById("char-count");
const tabs = document.querySelectorAll(".tab");
const syncIndicator = document.getElementById("sync-indicator");
const pinError = document.getElementById("pin-error");
const dots = [0, 1, 2, 3].map((i) => document.getElementById(`dot-${i}`));

// ── PIN ─────────────────────────────────────────────────────
let pinBuffer = "";

// Il PIN corretto è salvato in localStorage (il primo utente lo "imposta" al primo accesso)
// In alternativa hardcodalo direttamente in CORRECT_PIN sopra
function getCorrectPin() {
  if (CORRECT_PIN) return CORRECT_PIN;
  return localStorage.getItem(PIN_STORAGE_K) || null;
}

function setupPin() {
  document.querySelectorAll(".pin-key[data-n]").forEach((btn) => {
    btn.addEventListener("click", () => onPinDigit(btn.dataset.n));
  });
  document.getElementById("pin-del").addEventListener("click", onPinDel);
}

function onPinDigit(d) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  updatePinDots();
  if (pinBuffer.length === 4) setTimeout(checkPin, 80);
}

function onPinDel() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
  pinError.classList.add("hidden");
}

function updatePinDots(error = false) {
  dots.forEach((dot, i) => {
    dot.classList.toggle("filled", i < pinBuffer.length && !error);
    dot.classList.toggle("error", i < pinBuffer.length && error);
  });
}

function checkPin() {
  const correct = getCorrectPin();

  // Prima volta: nessun PIN salvato → lo imposto adesso
  if (!correct) {
    localStorage.setItem(PIN_STORAGE_K, pinBuffer);
    unlockApp();
    return;
  }

  if (pinBuffer === correct) {
    unlockApp();
  } else {
    updatePinDots(true);
    pinError.classList.remove("hidden");
    setTimeout(() => {
      pinBuffer = "";
      updatePinDots();
      pinError.classList.add("hidden");
    }, 900);
  }
}

function unlockApp() {
  pinScreen.style.display = "none";
  appEl.classList.remove("hidden");
  initCanvas();
}

// ── Canvas init ─────────────────────────────────────────────
async function initCanvas() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  state.panX = (vw - CANVAS_W) / 2;
  state.panY = (vh - CANVAS_H) / 2;
  applyPan();
  bindEvents();
  await loadItems();
  subscribeRealtime();
}

// ── Pan ─────────────────────────────────────────────────────
function applyPan() {
  canvas.style.transform = `translate(${state.panX}px,${state.panY}px)`;
}

function clampPan(x, y) {
  const vw = window.innerWidth,
    vh = window.innerHeight,
    m = 80;
  return {
    x: Math.max(m - CANVAS_W, Math.min(vw - m, x)),
    y: Math.max(m - CANVAS_H, Math.min(vh - m, y)),
  };
}

// ── Items ───────────────────────────────────────────────────
function randomRotation() {
  return +(Math.random() * 8 - 4).toFixed(2);
}

function placeInCenter() {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  return {
    x: Math.round(vw / 2 - state.panX + (Math.random() * 80 - 40)),
    y: Math.round(vh / 2 - state.panY + (Math.random() * 80 - 40)),
  };
}

function createPhotoEl(item) {
  const el = document.createElement("div");
  el.className = "item item-photo";
  el.dataset.id = item.id;
  el.style.cssText = `left:${item.x}px;top:${item.y}px;width:${ITEM_W_PHOTO + 16}px;transform:rotate(${item.rot}deg);z-index:${item.z || 1}`;
  const img = document.createElement("img");
  // URL pubblico del bucket
  img.src = sb.storage
    .from("diario")
    .getPublicUrl(item.storage_path).data.publicUrl;
  img.draggable = false;
  img.loading = "lazy";
  el.appendChild(img);
  const cap = document.createElement("div");
  cap.className = "photo-caption";
  el.appendChild(cap);
  canvas.appendChild(el);
  bindItemEvents(el);
  state.itemMap[item.id] = el;
  return el;
}

function createNoteEl(item) {
  const el = document.createElement("div");
  el.className = "item item-note";
  el.dataset.id = item.id;
  el.style.cssText = `left:${item.x}px;top:${item.y}px;transform:rotate(${item.rot}deg);z-index:${item.z || 1}`;
  el.textContent = item.text;
  canvas.appendChild(el);
  bindItemEvents(el);
  state.itemMap[item.id] = el;
  return el;
}

// ── Drag items ──────────────────────────────────────────────
const LONG_PRESS_MS = 250;
const MOVE_THRESHOLD = 8;

function bindItemEvents(el) {
  el.addEventListener("touchstart", onItemTouchStart, { passive: true });
  el.addEventListener("mousedown", onItemMouseDown);
}

function onItemTouchStart(e) {
  const touch = e.touches[0];
  state.touchStartX = touch.clientX;
  state.touchStartY = touch.clientY;
  state.longPressItem = e.currentTarget;
  state.longPressTimer = setTimeout(
    () => startItemDrag(state.longPressItem, touch.clientX, touch.clientY),
    LONG_PRESS_MS,
  );
}

function onItemMouseDown(e) {
  e.stopPropagation();
  startItemDrag(e.currentTarget, e.clientX, e.clientY);
}

function startItemDrag(el, cx, cy) {
  state.isDraggingItem = true;
  state.draggingItem = el;
  const rect = el.getBoundingClientRect();
  state.dragOffsetX = cx - rect.left;
  state.dragOffsetY = cy - rect.top;
  el.classList.add("dragging");
  const z = ++state.zCounter;
  el.style.zIndex = z;
}

function moveItemDrag(cx, cy) {
  const el = state.draggingItem;
  if (!el) return;
  el.style.left = `${cx - state.panX - state.dragOffsetX}px`;
  el.style.top = `${cy - state.panY - state.dragOffsetY}px`;
}

async function endItemDrag() {
  if (!state.draggingItem) return;
  const el = state.draggingItem;
  el.classList.remove("dragging");
  state.draggingItem = null;
  state.isDraggingItem = false;
  // Salva posizione su Supabase
  const id = el.dataset.id;
  if (id) {
    showSync();
    await sb
      .from("items")
      .update({
        x: parseInt(el.style.left),
        y: parseInt(el.style.top),
        z: parseInt(el.style.zIndex) || 1,
      })
      .eq("id", id);
    hideSync();
  }
}

// ── Canvas pan events ────────────────────────────────────────
function bindEvents() {
  canvasWrapper.addEventListener("touchstart", onCanvasTouchStart, {
    passive: true,
  });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("touchcancel", onTouchEnd);
  canvasWrapper.addEventListener("mousedown", onCanvasMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  fab.addEventListener("click", openPanel);
  panelClose.addEventListener("click", closePanel);
  overlay.addEventListener("click", closePanel);
  tabs.forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)),
  );
  photoInput.addEventListener("change", onPhotoSelected);
  photoDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    photoDrop.classList.add("dragover");
  });
  photoDrop.addEventListener("dragleave", () =>
    photoDrop.classList.remove("dragover"),
  );
  photoDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    photoDrop.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  });
  photoConfirm.addEventListener("click", onPhotoConfirm);
  textConfirm.addEventListener("click", onTextConfirm);
  textInput.addEventListener("input", () => {
    charCount.textContent = `${textInput.value.length} / 400`;
  });
}

function onCanvasTouchStart(e) {
  if (e.touches.length !== 1 || state.isDraggingItem) return;
  const t = e.touches[0];
  state.isPanning = true;
  state.panStartX = t.clientX;
  state.panStartY = t.clientY;
  state.panOriginX = state.panX;
  state.panOriginY = state.panY;
  canvasWrapper.classList.add("grabbing");
}

function onTouchMove(e) {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const moved =
    Math.abs(t.clientX - state.touchStartX) > MOVE_THRESHOLD ||
    Math.abs(t.clientY - state.touchStartY) > MOVE_THRESHOLD;
  if (moved && state.longPressTimer) {
    clearTimeout(state.longPressTimer);
    state.longPressTimer = null;
  }
  if (state.isDraggingItem) {
    e.preventDefault();
    moveItemDrag(t.clientX, t.clientY);
  } else if (state.isPanning) {
    e.preventDefault();
    doPan(t.clientX, t.clientY);
  }
}

function onTouchEnd() {
  clearTimeout(state.longPressTimer);
  state.longPressTimer = null;
  state.longPressItem = null;
  if (state.isDraggingItem) endItemDrag();
  else {
    state.isPanning = false;
    canvasWrapper.classList.remove("grabbing");
  }
}

function onCanvasMouseDown(e) {
  if (e.button !== 0 || state.isDraggingItem) return;
  state.isPanning = true;
  state.panStartX = e.clientX;
  state.panStartY = e.clientY;
  state.panOriginX = state.panX;
  state.panOriginY = state.panY;
  canvasWrapper.classList.add("grabbing");
}

function onMouseMove(e) {
  if (state.isDraggingItem) moveItemDrag(e.clientX, e.clientY);
  else if (state.isPanning) doPan(e.clientX, e.clientY);
}

function onMouseUp() {
  if (state.isDraggingItem) endItemDrag();
  else {
    state.isPanning = false;
    canvasWrapper.classList.remove("grabbing");
  }
}

function doPan(cx, cy) {
  const c = clampPan(
    state.panOriginX + cx - state.panStartX,
    state.panOriginY + cy - state.panStartY,
  );
  state.panX = c.x;
  state.panY = c.y;
  applyPan();
}

// ── Panel ────────────────────────────────────────────────────
function openPanel() {
  panel.classList.remove("hidden");
  overlay.classList.remove("hidden");
  fab.classList.add("open");
}
function closePanel() {
  panel.classList.add("hidden");
  overlay.classList.add("hidden");
  fab.classList.remove("open");
}
function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.toggle("active", c.id === `tab-${name}`));
}

// ── Image compress ───────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > COMPRESS_MAX || height > COMPRESS_MAX) {
        const r = Math.min(COMPRESS_MAX / width, COMPRESS_MAX / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height);
      c.toBlob((blob) => resolve(blob), "image/jpeg", COMPRESS_Q);
    };
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const blob = await compressImage(file);
    const dataUrl = await blobToDataUrl(blob);
    state.pendingPhotos.push({ blob, dataUrl });
    addPreviewThumb(dataUrl, state.pendingPhotos.length - 1);
  }
  photoConfirm.classList.toggle("hidden", state.pendingPhotos.length === 0);
}

function addPreviewThumb(dataUrl, idx) {
  const wrap = document.createElement("div");
  wrap.className = "preview-thumb";
  const img = document.createElement("img");
  img.src = dataUrl;
  const btn = document.createElement("button");
  btn.className = "remove-thumb";
  btn.innerHTML = "×";
  btn.addEventListener("click", () => {
    state.pendingPhotos[idx] = null;
    wrap.remove();
    photoConfirm.classList.toggle(
      "hidden",
      state.pendingPhotos.filter(Boolean).length === 0,
    );
  });
  wrap.appendChild(img);
  wrap.appendChild(btn);
  photoPreview.appendChild(wrap);
}

function onPhotoSelected() {
  handleFiles(photoInput.files);
  photoInput.value = "";
}

async function onPhotoConfirm() {
  const photos = state.pendingPhotos.filter(Boolean);
  if (!photos.length) return;
  closePanel();
  showSync();
  for (const { blob } of photos) {
    const path = `photos/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const { error: upErr } = await sb.storage
      .from("diario")
      .upload(path, blob, { contentType: "image/jpeg" });
    if (upErr) {
      console.error("Upload error", upErr);
      continue;
    }
    const pos = placeInCenter();
    const rot = randomRotation();
    const { data, error } = await sb
      .from("items")
      .insert({
        type: "photo",
        storage_path: path,
        x: pos.x,
        y: pos.y,
        rot,
        z: ++state.zCounter,
      })
      .select()
      .single();
    if (!error && data) createPhotoEl(data);
  }
  state.pendingPhotos = [];
  photoPreview.innerHTML = "";
  photoConfirm.classList.add("hidden");
  hideSync();
}

async function onTextConfirm() {
  const text = textInput.value.trim();
  if (!text) return;
  closePanel();
  showSync();
  const pos = placeInCenter();
  const rot = randomRotation();
  const { data, error } = await sb
    .from("items")
    .insert({
      type: "note",
      text,
      x: pos.x,
      y: pos.y,
      rot,
      z: ++state.zCounter,
    })
    .select()
    .single();
  if (!error && data) createNoteEl(data);
  textInput.value = "";
  charCount.textContent = "0 / 400";
  hideSync();
}

// ── Load all items ───────────────────────────────────────────
async function loadItems() {
  showSync();
  const { data, error } = await sb
    .from("items")
    .select("*")
    .order("created_at");
  hideSync();
  if (error) {
    console.error(error);
    return;
  }
  data.forEach((item) => {
    if (item.type === "photo") createPhotoEl(item);
    else if (item.type === "note") createNoteEl(item);
  });
}

// ── Realtime sync ────────────────────────────────────────────
function subscribeRealtime() {
  sb.channel("diario-items")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "items" },
      (payload) => {
        const item = payload.new;
        if (state.itemMap[item.id]) return; // già presente (l'abbiamo creato noi)
        if (item.type === "photo") createPhotoEl(item);
        else if (item.type === "note") createNoteEl(item);
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "items" },
      (payload) => {
        const item = payload.new;
        const el = state.itemMap[item.id];
        if (!el || el === state.draggingItem) return; // non sovrascrivere se stiamo draggando noi
        el.style.left = `${item.x}px`;
        el.style.top = `${item.y}px`;
        el.style.zIndex = item.z || 1;
      },
    )
    .subscribe();
}

// ── Sync indicator ───────────────────────────────────────────
function showSync() {
  syncIndicator.classList.remove("hidden");
}
function hideSync() {
  syncIndicator.classList.add("hidden");
}

// ── Boot ─────────────────────────────────────────────────────
setupPin();
