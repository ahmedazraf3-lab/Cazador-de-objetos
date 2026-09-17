const DRAWER_KEY = 'scannerDrawer';
const TOTAL_AI_CATEGORIES = 80;

const LABELS_ES = {
  person:'Persona',bicycle:'Bicicleta',car:'Coche',motorcycle:'Moto',airplane:'Avión',bus:'Autobús',
  train:'Tren',truck:'Camión',boat:'Barco','traffic light':'Semáforo','fire hydrant':'Boca de incendios',
  'stop sign':'Señal de stop','parking meter':'Parquímetro',bench:'Banco',bird:'Pájaro',cat:'Gato',dog:'Perro',
  horse:'Caballo',sheep:'Oveja',cow:'Vaca',elephant:'Elefante',bear:'Oso',zebra:'Cebra',giraffe:'Jirafa',
  backpack:'Mochila',umbrella:'Paraguas',handbag:'Bolso',tie:'Corbata',suitcase:'Maleta',frisbee:'Frisbee',
  skis:'Esquís',snowboard:'Snowboard','sports ball':'Balón',kite:'Cometa','baseball bat':'Bate de béisbol',
  'baseball glove':'Guante de béisbol',skateboard:'Monopatín',surfboard:'Tabla de surf','tennis racket':'Raqueta',
  bottle:'Botella','wine glass':'Copa de vino',cup:'Taza',fork:'Tenedor',knife:'Cuchillo',spoon:'Cuchara',
  bowl:'Bol',banana:'Plátano',apple:'Manzana',sandwich:'Sándwich',orange:'Naranja',broccoli:'Brócoli',
  carrot:'Zanahoria','hot dog':'Perrito caliente',pizza:'Pizza',donut:'Donut',cake:'Tarta',chair:'Silla',
  couch:'Sofá','potted plant':'Planta',bed:'Cama','dining table':'Mesa',toilet:'Inodoro',tv:'Televisor',
  laptop:'Portátil',mouse:'Ratón',remote:'Mando',keyboard:'Teclado','cell phone':'Móvil',microwave:'Microondas',
  oven:'Horno',toaster:'Tostadora',sink:'Fregadero',refrigerator:'Nevera',book:'Libro',clock:'Reloj',
  vase:'Jarrón',scissors:'Tijeras','teddy bear':'Osito de peluche','hair drier':'Secador',toothbrush:'Cepillo de dientes'
};
function translateLabel(c){ return LABELS_ES[c] || c; }

let video, overlay, ctx, frozenCanvas, captureCanvas;
let model=null, detections=[], manualMode=false, dragging=false, dragStart=null, currentRect=null;
let pendingCapture=null;
let detectTimer=null;

function loadDrawer(){ return JSON.parse(localStorage.getItem(DRAWER_KEY) || '[]'); }
function saveDrawer(items){ localStorage.setItem(DRAWER_KEY, JSON.stringify(items)); }

function goCamera(){ location.hash = '#camera'; }
function goDrawer(){ location.hash = '#drawer'; }

function tabbar(active){
  return `<div class="tabbar">
    <button class="tab ${active==='camera'?'active':''}" onclick="goCamera()"><span class="icon">📷</span>Cámara</button>
    <button class="tab ${active==='drawer'?'active':''}" onclick="goDrawer()"><span class="icon">🗂️</span>Cajón</button>
  </div>`;
}

// ---------- CÁMARA ----------
function renderCameraPage(){
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="topbar"><span class="title">📷 Enfoca un objeto</span></div>
    <div class="camera-wrap" id="cameraWrap">
      <video id="video" autoplay playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div id="hintBanner" class="hint-banner" style="display:none;"></div>
      <button id="fabPencil" class="fab" onclick="toggleManualMode()">✏️</button>
    </div>
    <p style="text-align:center;font-size:12px;color:var(--text-soft);padding:10px 16px;">
      Toca un recuadro detectado para guardarlo, o usa el lápiz para seleccionar manualmente.
    </p>
    ${tabbar('camera')}
  `;
  video = document.getElementById('video');
  overlay = document.getElementById('overlay');
  ctx = overlay.getContext('2d');
  frozenCanvas = document.getElementById('frozenCanvas');
  captureCanvas = document.getElementById('captureCanvas');
  startCamera();
  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
}

function showHint(text){
  const b = document.getElementById('hintBanner');
  if(!b) return;
  if(!text){ b.style.display='none'; return; }
  b.textContent = text;
  b.style.display = 'block';
}

async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      frozenCanvas.width = video.videoWidth;
      frozenCanvas.height = video.videoHeight;
      if(!model){
        showHint('Cargando el modelo de IA...');
        cocoSsd.load().then(m => { model = m; showHint(''); detectLoop(); });
      } else {
        detectLoop();
      }
    };
  } catch(err){
    showHint('No se pudo acceder a la cámara. Revisa los permisos.');
  }
}

function detectLoop(){
  if(manualMode || !model || !video || video.readyState < 2){
    detectTimer = setTimeout(detectLoop, 400);
    return;
  }
  model.detect(video).then(preds => {
    detections = preds;
    drawDetections();
    detectTimer = setTimeout(detectLoop, 400);
  }).catch(() => { detectTimer = setTimeout(detectLoop, 400); });
}

function drawDetections(){
  if(manualMode) return;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  detections.forEach(d => {
    const [x, y, w, h] = d.bbox;
    ctx.strokeStyle = '#00E5D1';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    const label = translateLabel(d.class) + ' ' + Math.round(d.score*100) + '%';
    ctx.font = '16px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#00E5D1';
    ctx.fillRect(x, Math.max(0,y-24), tw+12, 24);
    ctx.fillStyle = '#0F172A';
    ctx.fillText(label, x+6, Math.max(16,y-6));
  });
}

function toCanvasCoords(evt){
  const rect = overlay.getBoundingClientRect();
  const scaleX = overlay.width / rect.width;
  const scaleY = overlay.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function findDetectionAt(x, y){
  return detections.find(d => {
    const [bx, by, bw, bh] = d.bbox;
    return x >= bx && x <= bx+bw && y >= by && y <= by+bh;
  });
}

window.toggleManualMode = function(){
  manualMode = !manualMode;
  const fab = document.getElementById('fabPencil');
  if(manualMode){
    fab.classList.add('active');
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    frozenCanvas.getContext('2d').drawImage(video, 0, 0, frozenCanvas.width, frozenCanvas.height);
    showHint('Dibuja un recuadro alrededor del objeto');
  } else {
    fab.classList.remove('active');
    showHint('');
    detectLoop();
  }
};

function onPointerDown(evt){
  if(!manualMode) {
    const p = toCanvasCoords(evt);
    const det = findDetectionAt(p.x, p.y);
    if(det) captureFromDetection(det);
    return;
  }
  dragging = true;
  dragStart = toCanvasCoords(evt);
}
function onPointerMove(evt){
  if(!manualMode || !dragging) return;
  const p = toCanvasCoords(evt);
  currentRect = normalizeRect(dragStart, p);
  redrawManualFrame();
}
function onPointerUp(evt){
  if(!manualMode || !dragging) return;
  dragging = false;
  if(currentRect && currentRect.w > 15 && currentRect.h > 15){
    captureFromManualRect(currentRect);
  }
  currentRect = null;
}
function normalizeRect(a, b){
  return { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), w: Math.abs(b.x-a.x), h: Math.abs(b.y-a.y) };
}
function redrawManualFrame(){
  ctx.drawImage(frozenCanvas, 0, 0);
  if(currentRect){
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 3;
    ctx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
  }
}

function captureFromDetection(det){
  const [x, y, w, h] = det.bbox;
  captureCanvas.width = w; captureCanvas.height = h;
  captureCanvas.getContext('2d').drawImage(video, x, y, w, h, 0, 0, w, h);
  pendingCapture = {
    image: captureCanvas.toDataURL('image/jpeg', 0.85),
    name: translateLabel(det.class),
    source: 'ai',
    category: det.class
  };
  renderConfirmSheet();
}
function captureFromManualRect(rect){
  captureCanvas.width = rect.w; captureCanvas.height = rect.h;
  captureCanvas.getContext('2d').drawImage(frozenCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  pendingCapture = {
    image: captureCanvas.toDataURL('image/jpeg', 0.85),
    name: '',
    source: 'manual',
    category: 'manual'
  };
  renderConfirmSheet();
}

function renderConfirmSheet(){
  const wrap = document.getElementById('cameraWrap');
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'confirmSheet';
  sheet.innerHTML = `
    <img src="${pendingCapture.image}" />
    <input id="captureName" type="text" placeholder="Ponle un nombre" value="${pendingCapture.name}" />
    <div class="sheet-btns">
      <button class="btn btn-ghost" onclick="discardCapture()">Descartar</button>
      <button class="btn btn-primary" onclick="saveCapture()">Guardar en el cajón</button>
    </div>
  `;
  document.body.appendChild(sheet);
}
window.discardCapture = function(){
  const s = document.getElementById('confirmSheet');
  if(s) s.remove();
  pendingCapture = null;
  if(manualMode) toggleManualMode();
};
window.saveCapture = function(){
  const name = document.getElementById('captureName').value.trim() || 'Objeto sin nombre';
  const items = loadDrawer();
  items.unshift({
    id: Date.now(),
    name,
    image: pendingCapture.image,
    source: pendingCapture.source,
    category: pendingCapture.category,
    date: new Date().toISOString()
  });
  saveDrawer(items);
  const s = document.getElementById('confirmSheet');
  if(s) s.remove();
  pendingCapture = null;
  if(manualMode) toggleManualMode();
};

// ---------- CAJÓN ----------
function renderDrawerPage(){
  const items = loadDrawer();
  const aiCategories = new Set(items.filter(i => i.source==='ai').map(i => i.category));
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="topbar"><span class="title">🗂️ Tu cajón</span><span class="badge-count">${items.length} objetos</span></div>
    <div class="progress-wrap">
      <div class="progress-label"><span>Categorías descubiertas por IA</span><span>${aiCategories.size}/${TOTAL_AI_CATEGORIES}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round(aiCategories.size/TOTAL_AI_CATEGORIES*100)}%"></div></div>
    </div>
    <input class="search-input" type="text" placeholder="Buscar en tu colección..." oninput="onDrawerSearch(this.value)" />
    <div id="drawerGrid">${drawerGridHTML(items, '')}</div>
    ${tabbar('drawer')}
  `;
}

function drawerGridHTML(items, query){
  const q = query.trim().toLowerCase();
  const filtered = items.filter(i => !q || i.name.toLowerCase().includes(q));
  if(filtered.length === 0){
    return `<div class="empty-state">Todavía no has guardado ningún objeto.<br>Ve a la cámara y empieza a cazar 🔍</div>`;
  }
  return `<div class="grid">` + filtered.map(i => `
    <button class="item-card" onclick="openDetail(${i.id})">
      <img src="${i.image}" />
      <div class="info">
        <div class="name">${i.name}</div>
        <div class="tag">${i.source === 'ai' ? '🤖 IA' : '✏️ Manual'} · ${new Date(i.date).toLocaleDateString('es-ES')}</div>
      </div>
    </button>
  `).join('') + `</div>`;
}

window.onDrawerSearch = function(val){
  const grid = document.getElementById('drawerGrid');
  if(grid) grid.innerHTML = drawerGridHTML(loadDrawer(), val);
};

window.openDetail = function(id){
  const items = loadDrawer();
  const item = items.find(i => i.id === id);
  if(!item) return;
  const overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.id = 'detailOverlay';
  overlayEl.innerHTML = `
    <div class="modal">
      <img src="${item.image}" />
      <input id="editName" type="text" value="${item.name}" style="width:100%;padding:12px;border-radius:12px;border:1px solid #334155;background:#0F172A;color:#fff;font-size:15px;margin-bottom:12px;" />
      <div class="sheet-btns" style="margin-bottom:8px;">
        <button class="btn btn-ghost" onclick="closeDetail()">Cerrar</button>
        <button class="btn btn-primary" onclick="renameItem(${item.id})">Guardar cambios</button>
      </div>
      <button class="btn btn-block" style="background:#7F1D1D;color:#fff;" onclick="deleteItem(${item.id})">Eliminar</button>
    </div>
  `;
  document.body.appendChild(overlayEl);
};
window.closeDetail = function(){
  const o = document.getElementById('detailOverlay');
  if(o) o.remove();
};
window.renameItem = function(id){
  const items = loadDrawer();
  const item = items.find(i => i.id === id);
  const newName = document.getElementById('editName').value.trim();
  if(item && newName) item.name = newName;
  saveDrawer(items);
  closeDetail();
  renderDrawerPage();
};
window.deleteItem = function(id){
  let items = loadDrawer();
  items = items.filter(i => i.id !== id);
  saveDrawer(items);
  closeDetail();
  renderDrawerPage();
};

// ---------- ROUTER ----------
function stopCamera(){
  if(detectTimer) clearTimeout(detectTimer);
  if(video && video.srcObject){
    video.srcObject.getTracks().forEach(t => t.stop());
  }
}

function render(){
  const hash = location.hash || '#camera';
  stopCamera();
  if(hash === '#drawer') renderDrawerPage();
  else renderCameraPage();
}
window.addEventListener('hashchange', render);
window.addEventListener('load', () => {
  render();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});
