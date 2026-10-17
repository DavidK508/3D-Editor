import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = (sel) => document.querySelector(sel);

// ---------- Renderer / Scene ----------
const canvas = $('#canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1e);

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
camera.position.set(7, 5.5, 9);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.screenSpacePanning = true;

const ambient = new THREE.AmbientLight(0xffffff, 0.3);
const hemi = new THREE.HemisphereLight(0x9db4d6, 0x33251c, 0.45);
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(8, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
scene.add(ambient, hemi, sun, sun.target);

const grid = new THREE.GridHelper(20, 20, 0x555566, 0x2c2c36);
grid.name = '__grid';
const axes = new THREE.AxesHelper(1.6);
axes.name = '__axes';
scene.add(grid, axes);

const selectionBox = new THREE.BoxHelper(undefined, 0x2ee66a);
selectionBox.visible = false;
scene.add(selectionBox);

const tc = new TransformControls(camera, canvas);
tc.setSize(0.9);
scene.add(tc);

// ---------- State ----------
let selected = null;
let gizmoDragging = false;
const editorObjects = [];
let history = [];
let historyIndex = -1;
let suppressHistory = false;

const TYPE_LABELS = {
  box: 'Куб', sphere: 'Сфера', cylinder: 'Цилиндр', cone: 'Конус',
  torus: 'Тор', capsule: 'Капсула', knot: 'Узел', plane: 'Плоскость',
  pointLight: 'Свет', dirLight: 'Прожектор',
};

// ---------- Resize ----------
function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

// ---------- Object creation ----------
function makeMarker(color) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 12),
    new THREE.MeshBasicMaterial({ color, toneMapped: false })
  );
  marker.userData.isHelper = true;
  return marker;
}

function createObject(kind, record = true) {
  let obj;
  if (kind === 'pointLight') {
    obj = new THREE.PointLight(0xffffff, 5, 0, 2);
    obj.add(makeMarker(0xffee88));
    obj.userData.kind = 'pointLight';
  } else if (kind === 'dirLight') {
    obj = new THREE.DirectionalLight(0xffffff, 3);
    obj.target.position.set(0, -1, 0);
    obj.add(obj.target);
    obj.add(makeMarker(0x88ccff));
    obj.userData.kind = 'dirLight';
  } else {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.45, 0.55),
      metalness: 0.1,
      roughness: 0.7,
    });
    let geo;
    switch (kind) {
      case 'sphere': geo = new THREE.SphereGeometry(0.75, 32, 24); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32); break;
      case 'cone': geo = new THREE.ConeGeometry(0.7, 1.5, 32); break;
      case 'torus': geo = new THREE.TorusGeometry(0.6, 0.25, 20, 48); break;
      case 'capsule': geo = new THREE.CapsuleGeometry(0.45, 0.9, 8, 24); break;
      case 'knot': geo = new THREE.TorusKnotGeometry(0.55, 0.18, 128, 20); break;
      case 'plane': geo = new THREE.PlaneGeometry(2.5, 2.5); break;
      default: geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    }
    obj = new THREE.Mesh(geo, mat);
    obj.castShadow = kind !== 'plane';
    obj.receiveShadow = true;
    if (kind === 'plane') obj.rotation.x = -Math.PI / 2;
    obj.userData.kind = kind;
  }
  obj.userData.editorObject = true;
  obj.name = uniqueName(TYPE_LABELS[kind] || kind);
  scene.add(obj);
  editorObjects.push(obj);
  select(obj);
  rebuildOutliner();
  updateStatus();
  if (record) commitHistory();
  return obj;
}

function uniqueName(base) {
  let i = 1;
  let name = base;
  const names = new Set(editorObjects.map((o) => o.name));
  while (names.has(name)) name = `${base} ${++i}`;
  return name;
}

function removeObject(obj, record = true) {
  const idx = editorObjects.indexOf(obj);
  if (idx === -1) return;
  editorObjects.splice(idx, 1);
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m.dispose());
    }
  });
  if (selected === obj) select(null);
  rebuildOutliner();
  updateStatus();
  if (record) commitHistory();
}

function clearObjects() {
  while (editorObjects.length) {
    const obj = editorObjects.pop();
    scene.remove(obj);
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
  select(null);
  rebuildOutliner();
  updateStatus();
}

function duplicateSelected() {
  if (!selected) return;
  const data = serializeObject(selected);
  const copy = deserializeObject(data);
  copy.name = uniqueName(selected.name);
  copy.position.x += 1;
  copy.position.z += 1;
  scene.add(copy);
  editorObjects.push(copy);
  select(copy);
  rebuildOutliner();
  updateStatus();
  commitHistory();
}

// ---------- Selection ----------
function select(obj) {
  selected = obj || null;
  if (selected) {
    tc.attach(selected);
    selectionBox.setFromObject(selected);
    selectionBox.visible = true;
  } else {
    tc.detach();
    selectionBox.visible = false;
  }
  syncPropsUI();
  rebuildOutliner();
  updateStatus();
}

function updateSelectionBox() {
  if (selected) selectionBox.setFromObject(selected);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('pointerup', (e) => {
  if (!downPos || e.button !== 0) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  downPos = null;
  if (dx * dx + dy * dy > 16) return;
  if (gizmoDragging) return;

  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(editorObjects, true);
  let hitRoot = null;
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.editorObject) o = o.parent;
    hitRoot = o;
  }
  select(hitRoot);
});

tc.addEventListener('dragging-changed', (e) => {
  gizmoDragging = e.value;
  orbit.enabled = !e.value;
  if (!e.value) {
    updateSelectionBox();
    commitHistory();
  }
});

tc.addEventListener('objectChange', () => {
  updateSelectionBox();
  syncTransformInputs();
});

// ---------- Serialization ----------
function serializeObject(obj) {
  const data = {
    kind: obj.userData.kind,
    name: obj.name,
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray(),
    visible: obj.visible,
  };
  if (obj.isMesh) {
    data.material = {
      color: `#${obj.material.color.getHexString()}`,
      metalness: obj.material.metalness,
      roughness: obj.material.roughness,
      emissive: `#${obj.material.emissive.getHexString()}`,
      wireframe: obj.material.wireframe,
    };
  }
  if (obj.isLight) {
    data.light = {
      color: `#${obj.color.getHexString()}`,
      intensity: obj.intensity,
      distance: obj.distance ?? 0,
      castShadow: obj.castShadow,
    };
  }
  return data;
}

function deserializeObject(data) {
  const kind = data.kind;
  let obj;
  if (kind === 'pointLight') {
    obj = new THREE.PointLight(0xffffff, 5, 0, 2);
    obj.add(makeMarker(0xffee88));
  } else if (kind === 'dirLight') {
    obj = new THREE.DirectionalLight(0xffffff, 3);
    obj.target.position.set(0, -1, 0);
    obj.add(obj.target);
    obj.add(makeMarker(0x88ccff));
  } else {
    let geo;
    switch (kind) {
      case 'sphere': geo = new THREE.SphereGeometry(0.75, 32, 24); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32); break;
      case 'cone': geo = new THREE.ConeGeometry(0.7, 1.5, 32); break;
      case 'torus': geo = new THREE.TorusGeometry(0.6, 0.25, 20, 48); break;
      case 'capsule': geo = new THREE.CapsuleGeometry(0.45, 0.9, 8, 24); break;
      case 'knot': geo = new THREE.TorusKnotGeometry(0.55, 0.18, 128, 20); break;
      case 'plane': geo = new THREE.PlaneGeometry(2.5, 2.5); break;
      default: geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    }
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    obj.castShadow = kind !== 'plane';
    obj.receiveShadow = true;
  }
  obj.userData.editorObject = true;
  obj.userData.kind = kind;
  obj.name = data.name || uniqueName(TYPE_LABELS[kind] || kind);
  obj.position.fromArray(data.position || [0, 0, 0]);
  const r = data.rotation || [0, 0, 0];
  obj.rotation.set(r[0], r[1], r[2]);
  obj.scale.fromArray(data.scale || [1, 1, 1]);
  obj.visible = data.visible !== false;
  if (obj.isMesh && data.material) {
    obj.material.color.set(data.material.color || '#8ab4f8');
    obj.material.metalness = data.material.metalness ?? 0.1;
    obj.material.roughness = data.material.roughness ?? 0.7;
    if (data.material.emissive) obj.material.emissive.set(data.material.emissive);
    obj.material.wireframe = !!data.material.wireframe;
  }
  if (obj.isLight && data.light) {
    obj.color.set(data.light.color || '#ffffff');
    obj.intensity = data.light.intensity ?? 5;
    if (obj.isPointLight) obj.distance = data.light.distance ?? 0;
    obj.castShadow = !!data.light.castShadow;
  }
  return obj;
}

function serialize() {
  return {
    version: 1,
    background: `#${scene.background.getHexString()}`,
    grid: grid.visible,
    axes: axes.visible,
    shadows: renderer.shadowMap.enabled,
    camera: {
      position: camera.position.toArray(),
      target: orbit.target.toArray(),
    },
    objects: editorObjects.map(serializeObject),
  };
}

function deserialize(data, { fromHistory = false } = {}) {
  clearObjects();
  if (data.background) {
    scene.background = new THREE.Color(data.background);
    $('#scene-bg').value = `#${scene.background.getHexString()}`;
  }
  if (typeof data.grid === 'boolean') {
    grid.visible = data.grid;
    $('#scene-grid').checked = data.grid;
  }
  if (typeof data.axes === 'boolean') {
    axes.visible = data.axes;
    $('#scene-axes').checked = data.axes;
  }
  if (typeof data.shadows === 'boolean') {
    renderer.shadowMap.enabled = data.shadows;
    $('#scene-shadows').checked = data.shadows;
  }
  if (data.camera?.position) {
    camera.position.fromArray(data.camera.position);
    if (data.camera.target) orbit.target.fromArray(data.camera.target);
  }
  for (const objData of data.objects || []) {
    const obj = deserializeObject(objData);
    scene.add(obj);
    editorObjects.push(obj);
  }
  rebuildOutliner();
  updateStatus();
  if (!fromHistory) commitHistory();
}

// ---------- History ----------
function commitHistory() {
  if (suppressHistory) return;
  const snap = serialize();
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  suppressHistory = true;
  deserialize(JSON.parse(JSON.stringify(history[historyIndex])), { fromHistory: true });
  suppressHistory = false;
  updateHistoryButtons();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  suppressHistory = true;
  deserialize(JSON.parse(JSON.stringify(history[historyIndex])), { fromHistory: true });
  suppressHistory = false;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#btn-undo').disabled = historyIndex <= 0;
  $('#btn-redo').disabled = historyIndex >= history.length - 1;
}

// ---------- Outliner ----------
const outliner = $('#outliner');

function rebuildOutliner() {
  outliner.innerHTML = '';
  for (const obj of editorObjects) {
    const item = document.createElement('div');
    item.className = 'outliner-item' + (obj === selected ? ' selected' : '');

    const type = document.createElement('span');
    type.className = 'oi-type';
    type.textContent = TYPE_LABELS[obj.userData.kind] || obj.userData.kind;

    const name = document.createElement('span');
    name.className = 'oi-name';
    name.textContent = obj.name;
    name.title = 'Двойной клик — переименовать';
    name.addEventListener('dblclick', () => {
      const next = prompt('Имя объекта:', obj.name);
      if (next && next.trim()) {
        obj.name = next.trim();
        rebuildOutliner();
        syncPropsUI();
        commitHistory();
      }
    });

    const eye = document.createElement('button');
    eye.className = 'oi-btn';
    eye.textContent = obj.visible ? '◉' : '〇';
    eye.title = 'Видимость';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      obj.visible = !obj.visible;
      rebuildOutliner();
      commitHistory();
    });

    const del = document.createElement('button');
    del.className = 'oi-btn del';
    del.textContent = '✕';
    del.title = 'Удалить';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeObject(obj);
    });

    item.append(type, name, eye, del);
    item.addEventListener('click', () => select(obj));
    outliner.appendChild(item);
  }
}

// ---------- Properties UI ----------
const transformInputs = {
  position: { x: $('#pos-x'), y: $('#pos-y'), z: $('#pos-z') },
  rotation: { x: $('#rot-x'), y: $('#rot-y'), z: $('#rot-z') },
  scale: { x: $('#scl-x'), y: $('#scl-y'), z: $('#scl-z') },
};

const allTransformInputs = Object.values(transformInputs).flatMap((g) => Object.values(g));

function setDisabled(el, disabled) {
  el.disabled = disabled;
}

function syncTransformInputs() {
  if (!selected) return;
  for (const prop of ['position', 'rotation', 'scale']) {
    for (const axis of ['x', 'y', 'z']) {
      const input = transformInputs[prop][axis];
      let value = selected[prop][axis];
      if (prop === 'rotation') value = THREE.MathUtils.radToDeg(value);
      input.value = Math.round(value * 1000) / 1000;
    }
  }
}

function syncPropsUI() {
  const has = !!selected;
  $('#prop-name').disabled = !has;
  $('#prop-visible').disabled = !has;
  allTransformInputs.forEach((inp) => setDisabled(inp, !has));

  const isMesh = has && selected.isMesh;
  const isLight = has && selected.isLight;

  ['#mat-color', '#mat-metalness', '#mat-roughness', '#mat-wireframe'].forEach((s) => {
    $(s).disabled = !isMesh;
  });
  ['#light-color', '#light-intensity', '#light-distance', '#light-shadow'].forEach((s) => {
    $(s).disabled = !isLight;
  });
  $('#light-distance-row').style.visibility = isLight && selected.isPointLight ? 'visible' : 'hidden';

  if (!selected) {
    $('#prop-name').value = '';
    $('#prop-type').textContent = '—';
    return;
  }

  $('#prop-name').value = selected.name;
  $('#prop-type').textContent = TYPE_LABELS[selected.userData.kind] || selected.userData.kind;
  $('#prop-visible').checked = selected.visible;
  syncTransformInputs();

  if (isMesh) {
    $('#mat-color').value = `#${selected.material.color.getHexString()}`;
    $('#mat-metalness').value = selected.material.metalness;
    $('#mat-roughness').value = selected.material.roughness;
    $('#mat-wireframe').checked = selected.material.wireframe;
  }
  if (isLight) {
    $('#light-color').value = `#${selected.color.getHexString()}`;
    $('#light-intensity').value = selected.intensity;
    if (selected.isPointLight) $('#light-distance').value = selected.distance;
    $('#light-shadow').checked = selected.castShadow;
  }
}

allTransformInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!selected) return;
    const prop = input.dataset.prop;
    const axis = input.dataset.axis;
    let value = parseFloat(input.value);
    if (Number.isNaN(value)) return;
    if (prop === 'rotation') value = THREE.MathUtils.degToRad(value);
    selected[prop][axis] = value;
    updateSelectionBox();
    commitHistory();
  });
});

$('#prop-name').addEventListener('change', (e) => {
  if (!selected) return;
  const next = e.target.value.trim();
  if (next) {
    selected.name = next;
    rebuildOutliner();
    commitHistory();
  }
});

$('#prop-visible').addEventListener('change', (e) => {
  if (!selected) return;
  selected.visible = e.target.checked;
  rebuildOutliner();
  commitHistory();
});

$('#mat-color').addEventListener('input', (e) => {
  if (selected?.isMesh) selected.material.color.set(e.target.value);
});
$('#mat-color').addEventListener('change', () => commitHistory());

$('#mat-metalness').addEventListener('input', (e) => {
  if (selected?.isMesh) selected.material.metalness = parseFloat(e.target.value);
});
$('#mat-metalness').addEventListener('change', () => commitHistory());

$('#mat-roughness').addEventListener('input', (e) => {
  if (selected?.isMesh) selected.material.roughness = parseFloat(e.target.value);
});
$('#mat-roughness').addEventListener('change', () => commitHistory());

$('#mat-wireframe').addEventListener('change', (e) => {
  if (!selected?.isMesh) return;
  selected.material.wireframe = e.target.checked;
  commitHistory();
});

$('#light-color').addEventListener('input', (e) => {
  if (selected?.isLight) selected.color.set(e.target.value);
});
$('#light-color').addEventListener('change', () => commitHistory());

$('#light-intensity').addEventListener('input', (e) => {
  if (selected?.isLight) selected.intensity = parseFloat(e.target.value);
});
$('#light-intensity').addEventListener('change', () => commitHistory());

$('#light-distance').addEventListener('input', (e) => {
  if (selected?.isPointLight) selected.distance = parseFloat(e.target.value);
});
$('#light-distance').addEventListener('change', () => commitHistory());

$('#light-shadow').addEventListener('change', (e) => {
  if (!selected?.isLight) return;
  selected.castShadow = e.target.checked;
  commitHistory();
});

// ---------- Scene settings ----------
$('#scene-bg').addEventListener('input', (e) => {
  scene.background = new THREE.Color(e.target.value);
});
$('#scene-bg').addEventListener('change', () => commitHistory());

$('#scene-grid').addEventListener('change', (e) => {
  grid.visible = e.target.checked;
  commitHistory();
});

$('#scene-axes').addEventListener('change', (e) => {
  axes.visible = e.target.checked;
  commitHistory();
});

$('#scene-shadows').addEventListener('change', (e) => {
  renderer.shadowMap.enabled = e.target.checked;
  commitHistory();
});

// ---------- Toolbar ----------
document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => createObject(btn.dataset.add));
});

function setTransformMode(mode) {
  tc.setMode(mode);
  document.querySelectorAll('.tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

document.querySelectorAll('.tool').forEach((btn) => {
  btn.addEventListener('click', () => setTransformMode(btn.dataset.mode));
});

$('#btn-space').addEventListener('click', () => {
  const next = tc.space === 'world' ? 'local' : 'world';
  tc.space = next;
  const btn = $('#btn-space');
  btn.textContent = next === 'world' ? 'Мировые оси' : 'Локальные оси';
  btn.classList.toggle('active', next === 'local');
});

$('#btn-duplicate').addEventListener('click', duplicateSelected);
$('#btn-delete').addEventListener('click', () => selected && removeObject(selected));
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);

function setView(dir) {
  const d = camera.position.distanceTo(orbit.target) || 10;
  const v = new THREE.Vector3(...dir).normalize();
  camera.position.copy(orbit.target).add(v.multiplyScalar(d));
  camera.lookAt(orbit.target);
}

$('#btn-view-persp').addEventListener('click', () => setView([1, 0.7, 1]));
$('#btn-view-front').addEventListener('click', () => setView([0, 0, 1]));
$('#btn-view-top').addEventListener('click', () => setView([0, 1, 0.001]));
$('#btn-view-side').addEventListener('click', () => setView([1, 0, 0]));

function focusSelected() {
  if (!selected) return;
  const box = new THREE.Box3().setFromObject(selected);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.5);
  orbit.target.copy(center);
  const dir = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(size * 2));
}

// ---------- Files ----------
function newScene() {
  if (editorObjects.length && !confirm('Очистить сцену? Несохранённые изменения будут потеряны.')) return;
  clearObjects();
  commitHistory();
}

async function openScene() {
  const result = await window.api.openProject();
  if (!result) return;
  try {
    deserialize(JSON.parse(result.content));
  } catch (err) {
    alert('Не удалось открыть файл: ' + err.message);
  }
}

async function saveScene() {
  const json = JSON.stringify(serialize(), null, 2);
  const path = await window.api.saveProject(json, 'scene.json');
  if (path) updateStatusMessage(`Сохранено: ${path}`);
}

async function exportGLB() {
  if (!editorObjects.length) {
    alert('Сцена пуста.');
    return;
  }
  const group = new THREE.Group();
  for (const obj of editorObjects) {
    const clone = obj.clone(true);
    clone.traverse((child) => {
      if (child.isMesh && child.material) child.material = child.material.clone();
    });
    group.add(clone);
  }
  const exporter = new GLTFExporter();
  exporter.parse(
    group,
    (result) => {
      const buffer = result instanceof ArrayBuffer ? result : new TextEncoder().encode(JSON.stringify(result)).buffer;
      window.api.saveBuffer(buffer, 'scene.glb', [{ name: 'glTF Binary', extensions: ['glb'] }]);
    },
    (err) => alert('Ошибка экспорта: ' + err.message),
    { binary: true }
  );
}

function screenshot() {
  renderer.render(scene, camera);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const path = await window.api.saveBuffer(reader.result, 'screenshot.png', [
        { name: 'PNG', extensions: ['png'] },
      ]);
      if (path) updateStatusMessage(`Скриншот: ${path}`);
    };
    reader.readAsArrayBuffer(blob);
  }, 'image/png');
}

$('#btn-new').addEventListener('click', newScene);
$('#btn-open').addEventListener('click', openScene);
$('#btn-save').addEventListener('click', saveScene);
$('#btn-export').addEventListener('click', exportGLB);
$('#btn-screenshot').addEventListener('click', screenshot);

// ---------- Menu ----------
window.api.onMenuAction((action) => {
  switch (action) {
    case 'new': newScene(); break;
    case 'open': openScene(); break;
    case 'save': saveScene(); break;
    case 'export-glb': exportGLB(); break;
    case 'screenshot': screenshot(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'duplicate': duplicateSelected(); break;
    case 'delete': selected && removeObject(selected); break;
    case 'focus': focusSelected(); break;
  }
});

// ---------- Keyboard ----------
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveScene(); return; }
  if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openScene(); return; }
  if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newScene(); return; }
  if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); exportGLB(); return; }
  if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); screenshot(); return; }

  switch (e.key.toLowerCase()) {
    case 'w': setTransformMode('translate'); break;
    case 'e': setTransformMode('rotate'); break;
    case 'r': setTransformMode('scale'); break;
    case 'f': focusSelected(); break;
    case 'escape': select(null); break;
    case 'delete':
    case 'backspace':
      if (selected) { e.preventDefault(); removeObject(selected); }
      break;
  }
});

// ---------- Status bar ----------
let statusFlashTimer = null;

function updateStatusMessage(msg) {
  $('#status-selected').textContent = msg;
  clearTimeout(statusFlashTimer);
  statusFlashTimer = setTimeout(updateStatus, 2500);
}

function updateStatus() {
  $('#status-objects').textContent = `Объектов: ${editorObjects.length}`;
  if (selected) {
    $('#status-selected').textContent = `Выбрано: ${selected.name} (${TYPE_LABELS[selected.userData.kind] || selected.userData.kind})`;
  } else {
    $('#status-selected').textContent = 'Ничего не выбрано';
  }
}

// ---------- Loop ----------
let frames = 0;
let lastFpsTime = performance.now();

renderer.setAnimationLoop(() => {
  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastFpsTime));
    $('#status-fps').textContent = `FPS: ${fps}`;
    frames = 0;
    lastFpsTime = now;
  }

  orbit.update();
  if (selected && selectionBox.visible) selectionBox.setFromObject(selected);
  renderer.render(scene, camera);
});

// ---------- Init ----------
createObject('box');
camera.position.set(7, 5.5, 9);
orbit.target.set(0, 0.5, 0);
history = [];
historyIndex = -1;
commitHistory();
updateHistoryButtons();
