const DRAWER_KEY = 'scannerDrawer';
const ROOM_TEMPLATE_KEY = 'selectedRoomTemplate';
const ROOM_LAYOUT_KEY = 'myRoomLayout';
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

const ROOM_TEMPLATES = [
  {id:'salon', name:'Salón', emoji:'🛋️', floor:0xC9A876, wallBack:0xF2EDE4, wallSide:0xEAE3D6},
  {id:'dormitorio', name:'Dormitorio', emoji:'🛏️', floor:0xB9C8D9, wallBack:0xEAF1F8, wallSide:0xDCE7F1},
  {id:'cocina', name:'Cocina', emoji:'🍳', floor:0xD8CFC0, wallBack:0xFFFFFF, wallSide:0xF2F2F2},
  {id:'estudio', name:'Estudio', emoji:'📚', floor:0x8C6F52, wallBack:0xE8E2D6, wallSide:0xDED5C4}
];

let video, overlay, ctx, frozenCanvas, captureCanvas;
let model=null, detections=[], manualMode=false, dragging=false, dragStart=null, currentRect=null;
let pendingCapture=null;
let detectTimer=null;

// ---- Three.js room state ----
let renderer, scene, camera, controls, roomAnimId=null;
let placedMeshes = []; // {mesh, itemId}
let selectedMesh = null;
let objDragging = false;
let raycaster, pointerVec;
const floorHalf = 3;

function loadDrawer(){ return JSON.parse(localStorage.getItem(DRAWER_KEY) || '[]'); }
function saveDrawer(items){ localStorage.setItem(DRAWER_KEY, JSON.stringify(items)); }
function loadLayout(){ return JSON.parse(localStorage.getItem(ROOM_LAYOUT_KEY) || '{"templateId":null,"objects":[]}'); }
function saveLayoutData(data){ localStorage.setItem(ROOM_LAYOUT_KEY, JSON.stringify(data)); }

function goCamera(){ location.hash = '#camera'; }
function goDrawer(){ location.hash = '#drawer'; }
function goHome(){ location.hash = '#home'; }
function goRoom(){ location.hash = '#room'; }

function tabbar(active){
  return `<div class="tabbar">
    <button class="tab ${active==='camera'?'active':''}" onclick="goCamera()"><span class="icon">📷</span>Cámara</button>
    <button class="tab ${active==='drawer'?'active':''}" onclick="goDrawer()"><span class="icon">🗂️</span>Cajón</button>
    <button class="tab ${active==='home'?'active':''}" onclick="goHome()"><span class="icon">🏠</span>Vivienda</button>
    <button class="tab ${active==='room'?'active':''}" onclick="goRoom()"><span class="icon">🛋️</span>Mi sala</button>
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
  pendingCapture = { image: captureCanvas.toDataURL('image/jpeg', 0.85), name: translateLabel(det.class), source: 'ai', category: det.class };
  renderConfirmSheet();
}
function captureFromManualRect(rect){
  captureCanvas.width = rect.w; captureCanvas.height = rect.h;
  captureCanvas.getContext('2d').drawImage(frozenCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  pendingCapture = { image: captureCanvas.toDataURL('image/jpeg', 0.85), name: '', source: 'manual', category: 'manual' };
  renderConfirmSheet();
}
function renderConfirmSheet(){
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'confirmSheet';
  sheet.innerHTML = `
    <img src="${pendingCapture.image}" />
    <input id="captureName" type="text" placeholder="Ponle un nombre" value="${pendingCapture.name}" />
    <div class="sheet-btns">
      <button class="btn btn-ghost" onclick="discardCapture()">Descartar</button>
      <button class="btn btn-primary" onclick="saveCapture()">Guardar en el cajón</button>
    </div>`;
  document.body.appendChild(sheet);
}
window.discardCapture = function(){
  const s = document.getElementById('confirmSheet'); if(s) s.remove();
  pendingCapture = null;
  if(manualMode) toggleManualMode();
};
window.saveCapture = function(){
  const name = document.getElementById('captureName').value.trim() || 'Objeto sin nombre';
  const items = loadDrawer();
  items.unshift({ id: Date.now(), name, image: pendingCapture.image, source: pendingCapture.source, category: pendingCapture.category, date: new Date().toISOString() });
  saveDrawer(items);
  const s = document.getElementById('confirmSheet'); if(s) s.remove();
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
      <div class="info"><div class="name">${i.name}</div>
      <div class="tag">${i.source === 'ai' ? '🤖 IA' : '✏️ Manual'} · ${new Date(i.date).toLocaleDateString('es-ES')}</div></div>
    </button>`).join('') + `</div>`;
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
    </div>`;
  document.body.appendChild(overlayEl);
};
window.closeDetail = function(){ const o = document.getElementById('detailOverlay'); if(o) o.remove(); };
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

// ---------- ELEGIR VIVIENDA ----------
function renderHomePage(){
  const layout = loadLayout();
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="topbar"><span class="title">🏠 Elige tu vivienda</span></div>
    <p style="font-size:12px;color:var(--text-soft);padding:0 16px 12px;">Elige una sala como base y luego decórala con tus objetos cazados.</p>
    <div class="home-grid">
      ${ROOM_TEMPLATES.map(t => `
        <button class="house-card ${layout.templateId===t.id?'selected':''}" onclick="selectTemplate('${t.id}')">
          <span class="emoji">${t.emoji}</span>
          <span class="name">${t.name}</span>
          <div class="swatch" style="background:#${t.floor.toString(16).padStart(6,'0')};"></div>
        </button>`).join('')}
    </div>
    ${tabbar('home')}
  `;
}
window.selectTemplate = function(id){
  const layout = loadLayout();
  if(layout.templateId && layout.templateId !== id && layout.objects.length > 0){
    if(!confirm('Cambiar de vivienda reiniciará los objetos colocados en tu sala. ¿Continuar?')) return;
  }
  if(layout.templateId !== id){
    saveLayoutData({ templateId: id, objects: [] });
  }
  goRoom();
};

// ---------- MI SALA (3D) ----------
function renderRoomPage(){
  const layout = loadLayout();
  if(!layout.templateId){ goHome(); return; }
  const template = ROOM_TEMPLATES.find(t => t.id === layout.templateId);
  const items = loadDrawer();
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="topbar"><span class="title">${template.emoji} ${template.name}</span><button class="badge-count" onclick="goHome()">Cambiar</button></div>
    <div class="room-canvas-wrap" id="roomCanvasWrap"></div>
    <div class="tray">
      ${items.length===0
        ? `<span class="tray-empty">Aún no tienes objetos cazados. Ve a la cámara 📷</span>`
        : items.map(i => `<button class="tray-item" onclick="addObjectToRoom(${i.id})"><img src="${i.image}" /></button>`).join('')}
    </div>
    ${tabbar('room')}
  `;
  initRoomScene(template, layout);
}

function initRoomScene(template, layout){
  const wrap = document.getElementById('roomCanvasWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0F172A);

  camera = new THREE.PerspectiveCamera(55, w/h, 0.1, 100);
  camera.position.set(0, 3, 6);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  wrap.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(3, 5, 3);
  scene.add(dirLight);

  const floorGeo = new THREE.PlaneGeometry(floorHalf*2, floorHalf*2);
  const floorMat = new THREE.MeshStandardMaterial({ color: template.floor });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI/2;
  scene.add(floor);

  const wallH = 3;
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(floorHalf*2, wallH), new THREE.MeshStandardMaterial({ color: template.wallBack }));
  backWall.position.set(0, wallH/2, -floorHalf);
  scene.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(floorHalf*2, wallH), new THREE.MeshStandardMaterial({ color: template.wallSide }));
  leftWall.position.set(-floorHalf, wallH/2, 0);
  leftWall.rotation.y = Math.PI/2;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(floorHalf*2, wallH), new THREE.MeshStandardMaterial({ color: template.wallSide }));
  rightWall.position.set(floorHalf, wallH/2, 0);
  rightWall.rotation.y = -Math.PI/2;
  scene.add(rightWall);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI/2 - 0.05;
  controls.minDistance = 2;
  controls.maxDistance = 10;
  controls.target.set(0, 1, 0);

  raycaster = new THREE.Raycaster();
  pointerVec = new THREE.Vector2();
  placedMeshes = [];
  selectedMesh = null;

  const drawer = loadDrawer();
  layout.objects.forEach(o => {
    const item = drawer.find(d => d.id === o.itemId);
    if(item) addObjectToRoom(o.itemId, o);
  });

  renderer.domElement.addEventListener('pointerdown', onRoomPointerDown);
  renderer.domElement.addEventListener('pointermove', onRoomPointerMove);
  renderer.domElement.addEventListener('pointerup', onRoomPointerUp);

  if(roomAnimId) cancelAnimationFrame(roomAnimId);
  function animate(){
    roomAnimId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', onRoomResize);
}
function onRoomResize(){
  const wrap = document.getElementById('roomCanvasWrap');
  if(!wrap || !renderer) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addObjectToRoom = function(itemId, savedState){
  const drawer = loadDrawer();
  const item = drawer.find(d => d.id === itemId);
  if(!item || !scene) return;
  const loader = new THREE.TextureLoader();
  loader.load(item.image, (tex) => {
    const aspect = tex.image.width / tex.image.height;
    const height = 1.4;
    const geo = new THREE.PlaneGeometry(height*aspect, height);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(savedState ? savedState.x : (Math.random()-0.5)*1.5, height/2, savedState ? savedState.z : (Math.random()-0.5)*1.5);
    mesh.rotation.y = savedState ? savedState.rotY : 0;
    const scale = savedState ? savedState.scale : 1;
    mesh.scale.set(scale, scale, scale);
    scene.add(mesh);
    placedMeshes.push({ mesh, itemId });
    selectObject(mesh);
    saveRoomLayout();
  });
};

function selectObject(mesh){
  selectedMesh = mesh;
  renderControlBar();
}
function deselectObject(){
  selectedMesh = null;
  const bar = document.getElementById('controlBar');
  if(bar) bar.remove();
}
function renderControlBar(){
  let bar = document.getElementById('controlBar');
  if(!bar){
    bar = document.createElement('div');
    bar.className = 'control-bar';
    bar.id = 'controlBar';
    document.getElementById('roomCanvasWrap').appendChild(bar);
  }
  bar.innerHTML = `
    <button onclick="rotateSelected(-1)">↺</button>
    <button onclick="rotateSelected(1)">↻</button>
    <button onclick="scaleSelected(0.9)">−</button>
    <button onclick="scaleSelected(1.1)">+</button>
    <button onclick="deleteSelected()">🗑️</button>
    <button onclick="deselectObject()">✕</button>
  `;
}
window.rotateSelected = function(dir){
  if(!selectedMesh) return;
  selectedMesh.rotation.y += dir * (Math.PI/8);
  saveRoomLayout();
};
window.scaleSelected = function(factor){
  if(!selectedMesh) return;
  const newScale = Math.min(3, Math.max(0.3, selectedMesh.scale.x * factor));
  selectedMesh.scale.set(newScale, newScale, newScale);
  saveRoomLayout();
};
window.deleteSelected = function(){
  if(!selectedMesh) return;
  scene.remove(selectedMesh);
  placedMeshes = placedMeshes.filter(p => p.mesh !== selectedMesh);
  deselectObject();
  saveRoomLayout();
};
window.deselectObject = deselectObject;

function saveRoomLayout(){
  const layout = loadLayout();
  layout.objects = placedMeshes.map(p => ({
    itemId: p.itemId,
    x: p.mesh.position.x,
    z: p.mesh.position.z,
    rotY: p.mesh.rotation.y,
    scale: p.mesh.scale.x
  }));
  saveLayoutData(layout);
}

function getPointerNDC(evt){
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((evt.clientY - rect.top) / rect.height) * 2 + 1
  };
}
function onRoomPointerDown(evt){
  const p = getPointerNDC(evt);
  pointerVec.set(p.x, p.y);
  raycaster.setFromCamera(pointerVec, camera);
  const meshes = placedMeshes.map(m => m.mesh);
  const hits = raycaster.intersectObjects(meshes);
  if(hits.length > 0){
    selectObject(hits[0].object);
    objDragging = true;
    controls.enabled = false;
  } else {
    deselectObject();
  }
}
function onRoomPointerMove(evt){
  if(!objDragging || !selectedMesh) return;
  const p = getPointerNDC(evt);
  pointerVec.set(p.x, p.y);
  raycaster.setFromCamera(pointerVec, camera);
  const floorPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(floorPlane, point);
  if(point){
    const limit = floorHalf - 0.3;
    selectedMesh.position.x = Math.max(-limit, Math.min(limit, point.x));
    selectedMesh.position.z = Math.max(-limit, Math.min(limit, point.z));
  }
}
function onRoomPointerUp(){
  if(objDragging) saveRoomLayout();
  objDragging = false;
  controls.enabled = true;
}

function stopRoom(){
  if(roomAnimId) cancelAnimationFrame(roomAnimId);
  roomAnimId = null;
  window.removeEventListener('resize', onRoomResize);
  if(renderer){
    renderer.dispose();
    if(renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  scene = null; renderer = null; controls = null; placedMeshes = []; selectedMesh = null;
}

// ---------- ROUTER ----------
function stopCamera(){
  if(detectTimer) clearTimeout(detectTimer);
  if(video && video.srcObject){ video.srcObject.getTracks().forEach(t => t.stop()); }
}

function render(){
  const hash = location.hash || '#camera';
  stopCamera();
  stopRoom();
  if(hash === '#drawer') renderDrawerPage();
  else if(hash === '#home') renderHomePage();
  else if(hash === '#room') renderRoomPage();
  else renderCameraPage();
}
window.addEventListener('hashchange', render);
window.addEventListener('load', () => {
  render();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});
