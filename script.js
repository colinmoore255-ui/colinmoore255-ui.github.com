'use strict';

const canvas = document.querySelector('#game');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 28, 95);
scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x5b6b4a, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-35, 60, 20);
scene.add(sun);

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const types = ['grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'cobble'];
const icons = ['🌱', '🟫', '🪨', '🟨', '🪵', '🌿', '🟤', '⬛'];
const materials = Object.fromEntries([
  ['grass', 0x5f9f38], ['dirt', 0x765033], ['stone', 0x777777], ['sand', 0xd8c078],
  ['wood', 0x805b32], ['leaves', 0x3d8739], ['planks', 0xa47745], ['cobble', 0x656565]
].map(([name, color]) => [name, new THREE.MeshLambertMaterial({ color })]));
const blocks = new Map();
const meshes = new Map();
const key = (x, y, z) => `${x},${y},${z}`;
const heightAt = (x, z) => Math.max(2, Math.floor(5 + Math.sin(x * .18) * 1.8 + Math.cos(z * .16) * 1.7 + Math.sin((x + z) * .07) * 2));
function setBlock(x, y, z, type) {
  const id = key(x, y, z);
  if (blocks.has(id)) return;
  blocks.set(id, type);
  const mesh = new THREE.Mesh(blockGeometry, materials[type]);
  mesh.position.set(x + .5, y + .5, z + .5);
  scene.add(mesh);
  meshes.set(id, mesh);
}
function removeBlock(x, y, z) {
  const id = key(x, y, z), mesh = meshes.get(id);
  if (!mesh) return;
  scene.remove(mesh); meshes.delete(id); blocks.delete(id);
}
function growTree(x, y, z) {
  for (let i = 0; i < 4; i++) setBlock(x, y + i, z, 'wood');
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 2; dy <= 4; dy++) {
    if (Math.abs(dx) + Math.abs(dz) < 4 && !(dy === 4 && Math.abs(dx) + Math.abs(dz) > 1)) setBlock(x + dx, y + dy, z + dz, 'leaves');
  }
}
for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) {
  const top = heightAt(x, z);
  for (let y = 0; y <= top; y++) setBlock(x, y, z, y === 0 ? 'stone' : y < top - 3 ? 'stone' : y < top ? 'dirt' : 'grass');
}
for (let x = -18; x <= 18; x++) for (let z = -18; z <= 18; z++) {
  const top = heightAt(x, z), noise = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  if (Math.abs(x) > 3 && Math.abs(z) > 3 && noise - Math.floor(noise) > .975 && top > 3) growTree(x, top + 1, z);
}

const player = { pos: new THREE.Vector3(0, heightAt(0, 0) + 2, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: false };
const gameSettings = { sensitivity: .0022, fov: 75, invertY: false, quality: 'medium', skin: 'green' };
const keys = {};
const radius = .28, playerHeight = 1.8, eyeHeight = 1.62;
const solidAt = (x, y, z) => blocks.has(key(Math.floor(x), Math.floor(y), Math.floor(z)));
function collides(position) {
  for (let x = Math.floor(position.x - radius); x <= Math.floor(position.x + radius); x++) for (let y = Math.floor(position.y); y <= Math.floor(position.y + playerHeight - .05); y++) for (let z = Math.floor(position.z - radius); z <= Math.floor(position.z + radius); z++) if (solidAt(x, y, z)) return true;
  return false;
}
function move(axis, amount) {
  if (!amount) return;
  const start = player.pos[axis]; player.pos[axis] += amount;
  if (!collides(player.pos)) return;
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) { const middle = (low + high) / 2; player.pos[axis] = start + amount * middle; if (collides(player.pos)) high = middle; else low = middle; }
  player.pos[axis] = start + amount * low;
  if (axis === 'y') { if (amount < 0) player.grounded = true; player.vel.y = 0; }
}

let selected = 0, locked = false, started = false;
let multiplayerChannel = null, roomCode = '', remotePlayers = new Map();
const playerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const skinColors = { green: 0x55b64d, orange: 0xd16a48, blue: 0x4d82c4, purple: 0x8d5bc2 };
const raycaster = new THREE.Raycaster();
function target() { raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); const hits = raycaster.intersectObjects([...meshes.values()]); return hits.length && hits[0].distance < 7 ? hits[0] : null; }
function toast(message) { const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 1200); }
function renderHotbar() { document.querySelector('#hotbar').innerHTML = types.map((type, index) => `<button class="slot${index === selected ? ' selected' : ''}" title="${type}" data-index="${index}">${icons[index]}<small>${index + 1}</small></button>`).join(''); document.querySelectorAll('.slot').forEach(slot => slot.onclick = () => { selected = Number(slot.dataset.index); renderHotbar(); }); }
renderHotbar();
function breakBlock() { const hit = target(); if (!hit) return toast('Aim at a block'); const p = hit.object.position.clone().subScalar(.5); const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); if (y === 0) return toast('That block cannot be mined'); removeBlock(x, y, z); }
function placeBlock() { const hit = target(); if (!hit) return toast('Aim at a block'); const p = hit.object.position.clone().subScalar(.5).add(hit.face.normal); const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); if (!blocks.has(key(x, y, z))) { setBlock(x, y, z, types[selected]); if (collides(player.pos)) removeBlock(x, y, z); } }
function applyGameSettings() { camera.fov = gameSettings.fov; camera.updateProjectionMatrix(); renderer.setPixelRatio(gameSettings.quality === 'high' ? Math.min(devicePixelRatio, 2) : gameSettings.quality === 'low' ? 1 : Math.min(devicePixelRatio, 1.5)); document.querySelector('#gameSensitivityValue').textContent = (gameSettings.sensitivity * 1000).toFixed(1); document.querySelector('#gameFovValue').textContent = `${gameSettings.fov}°`; }
function beginWorld(captureInput) { started = true; document.querySelector('#start').classList.add('hidden'); document.querySelector('#chatToggle').classList.remove('hidden'); applyGameSettings(); document.documentElement.requestFullscreen?.().catch(() => {}); if (captureInput) canvas.requestPointerLock(); }
function enterWorld() { beginWorld(true); }
document.querySelector('#startButton').onclick = () => { leaveRoom(); enterWorld(); };
function launchVoxelCraft() { document.querySelector('#menu').classList.add('hidden'); document.querySelector('#gameShell').classList.remove('hidden'); document.querySelector('#start').classList.remove('hidden'); }
document.querySelector('#heroPlay').onclick = launchVoxelCraft;
canvas.onclick = () => { if (started && !locked) canvas.requestPointerLock(); };
document.onpointerlockchange = () => { locked = document.pointerLockElement === canvas; };
document.onmousemove = event => { if (!locked) return; player.yaw -= event.movementX * gameSettings.sensitivity; player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch + event.movementY * gameSettings.sensitivity * (gameSettings.invertY ? -1 : 1))); };
document.onmousedown = event => { if (!locked) return; if (event.button === 0) breakBlock(); if (event.button === 2) placeBlock(); };
document.oncontextmenu = event => event.preventDefault();
function makeRemotePlayer(skin) { const group = new THREE.Group(); const material = new THREE.MeshLambertMaterial({ color: skinColors[skin] || skinColors.green }); const dark = new THREE.MeshLambertMaterial({ color: 0x283342 }); const body = new THREE.Mesh(new THREE.BoxGeometry(.55, .8, .35), material); body.position.y = 1.15; const head = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), material); head.position.y = 1.82; const leftArm = new THREE.Mesh(new THREE.BoxGeometry(.18, .65, .18), material); leftArm.position.set(-.38, 1.2, 0); const rightArm = leftArm.clone(); rightArm.position.x = .38; const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(.18, .65, .18), dark); leftLeg.position.set(-.16, .48, 0); const rightLeg = leftLeg.clone(); rightLeg.position.x = .16; group.add(body, head, leftArm, rightArm, leftLeg, rightLeg); group.traverse(part => { part.castShadow = true; }); return group; }
function showRemotePlayer(id, skin) { let remote = remotePlayers.get(id); if (remote && remote.userData.skin !== skin) { removeRemotePlayer(id); remote = null; } if (!remote) { remote = makeRemotePlayer(skin); remote.userData.skin = skin; scene.add(remote); remotePlayers.set(id, remote); } return remote; }
function removeRemotePlayer(id) { const remote = remotePlayers.get(id); if (remote) { scene.remove(remote); remotePlayers.delete(id); } }
function roomMessage(message) { if (multiplayerChannel) multiplayerChannel.postMessage({ ...message, id: playerId }); }
function setRoomStatus(message) { document.querySelector('#roomStatus').textContent = message; }
function connectRoom(code) { if (multiplayerChannel) multiplayerChannel.close(); roomCode = code; multiplayerChannel = new BroadcastChannel(`voxelcraft-${code}`); multiplayerChannel.onmessage = event => { const message = event.data; if (!message || message.id === playerId) return; if (message.type === 'hello') { showRemotePlayer(message.id, message.skin); roomMessage({ type: 'welcome', target: message.id, x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, skin: gameSettings.skin }); } if (message.type === 'welcome' && (!message.target || message.target === playerId)) { const remote = showRemotePlayer(message.id, message.skin); remote.position.set(message.x, message.y, message.z); remote.rotation.y = message.yaw || 0; } if (message.type === 'position') { const remote = showRemotePlayer(message.id, message.skin); remote.position.set(message.x, message.y, message.z); remote.rotation.y = message.yaw || 0; } if (message.type === 'leave') removeRemotePlayer(message.id); if (message.type === 'chat') addChatMessage(message.name || 'Player', message.text, false); }; roomMessage({ type: 'hello', skin: gameSettings.skin }); setRoomStatus(`Connected to room ${code}`); document.querySelector('#roomCodeHud').textContent = code; document.querySelector('#roomBadge').classList.remove('hidden'); multiplayerModal.classList.add('hidden'); }
function leaveRoom() { if (multiplayerChannel) { roomMessage({ type: 'leave' }); multiplayerChannel.close(); multiplayerChannel = null; } remotePlayers.forEach((remote, id) => removeRemotePlayer(id)); roomCode = ''; setRoomStatus('Not connected'); document.querySelector('#roomBadge').classList.add('hidden'); }
setInterval(() => { if (multiplayerChannel && started) roomMessage({ type: 'position', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, skin: gameSettings.skin }); }, 100);
addEventListener('keydown', event => { keys[event.code] = true; if (event.code.startsWith('Digit')) { const index = Number(event.code.slice(5)) - 1; if (index >= 0 && index < types.length) { selected = index; renderHotbar(); } } if (event.code === 'Space') event.preventDefault(); });
addEventListener('keyup', event => { keys[event.code] = false; });

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), .05);
  if (locked) {
    const speed = keys.ShiftLeft ? 7 : 4.5, forward = new THREE.Vector3(Math.sin(player.yaw), 0, -Math.cos(player.yaw)), right = new THREE.Vector3(Math.cos(player.yaw), 0, Math.sin(player.yaw)), direction = new THREE.Vector3();
    if (keys.KeyW) direction.add(forward); if (keys.KeyS) direction.sub(forward); if (keys.KeyA) direction.sub(right); if (keys.KeyD) direction.add(right);
    if (direction.lengthSq()) direction.normalize();
    player.vel.x += Math.max(-24 * delta, Math.min(24 * delta, direction.x * speed - player.vel.x)); player.vel.z += Math.max(-24 * delta, Math.min(24 * delta, direction.z * speed - player.vel.z));
    move('x', player.vel.x * delta); move('z', player.vel.z * delta); if (!direction.lengthSq()) { player.vel.x *= Math.max(0, 1 - 12 * delta); player.vel.z *= Math.max(0, 1 - 12 * delta); }
    const canJump = player.grounded; player.grounded = false; player.vel.y -= 18 * delta; if (keys.Space && canJump) player.vel.y = 7; move('y', player.vel.y * delta);
    camera.position.set(player.pos.x, player.pos.y + eyeHeight, player.pos.z); camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }
  renderer.render(scene, camera);
}
animate();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const libraryGames = [
  ['VoxelCraft', 'arcade', '▦', 'Survival sandbox', 'Featured', true],
  ['Neon Drift', 'arcade', '◈', '2 min / reflex', 'Hot', false],
  ['Word Surge', 'puzzle', 'Aa', '5 min / solo', 'Daily', false],
  ['Orbit Hop', 'arcade', '◌', '3 min / timing', 'New', false],
  ['Gridlock', 'puzzle', '▦', '8 min / brain', 'Classic', false],
  ['Pixel Pool', 'chill', '●', '4 min / zen', 'Chill', false],
  ['Duel Dots', 'competitive', '••', '1 min / versus', '2 Player', false],
  ['Moon Maze', 'chill', '☾', '6 min / explore', 'Chill', false]
];
const gameGrid = document.querySelector('#gameGrid');
const searchInput = document.querySelector('#searchInput');
const emptyState = document.querySelector('#emptyState');
let activeCategory = 'all';
function renderLibrary() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = libraryGames.filter(game => (activeCategory === 'all' || game[1] === activeCategory) && game.slice(0, 5).join(' ').toLowerCase().includes(query));
  gameGrid.innerHTML = visible.map((game, index) => `<article class="library-card" style="animation-delay:${index * 40}ms"><div class="library-art"><span class="game-tag">${game[4].toUpperCase()}</span><span class="game-icon">${game[2]}</span><h3>${game[0]}</h3></div><div class="library-meta"><div><p>${game[0]}</p><small>${game[3]}</small></div><button class="library-play" type="button" data-play="${game[5]}">${game[5] ? '▶' : '↗'}</button></div></article>`).join('');
  emptyState.classList.toggle('hidden', visible.length > 0);
  gameGrid.querySelectorAll('[data-play="true"]').forEach(button => button.onclick = launchVoxelCraft);
  gameGrid.querySelectorAll('[data-play="false"]').forEach(button => button.onclick = () => button.textContent = 'SOON');
}
document.querySelectorAll('.category').forEach(button => button.onclick = () => { document.querySelectorAll('.category').forEach(item => item.classList.remove('active')); button.classList.add('active'); activeCategory = button.dataset.category; renderLibrary(); });
searchInput.oninput = renderLibrary;
document.querySelector('#themeButton').onclick = () => document.body.classList.toggle('dark-mode');
const settingsPanel = document.querySelector('#settingsPanel');
document.querySelector('#settingsButton').onclick = () => settingsPanel.classList.toggle('hidden');
document.querySelector('#settingsClose').onclick = () => settingsPanel.classList.add('hidden');
document.querySelector('#darkToggle').onchange = event => document.body.classList.toggle('dark-mode', event.target.checked);
document.querySelector('#motionToggle').onchange = event => document.body.classList.toggle('reduce-motion', event.target.checked);
document.querySelector('#compactToggle').onchange = event => document.body.classList.toggle('compact-cards', event.target.checked);
renderLibrary();

const gameSettingsModal = document.querySelector('#gameSettingsModal');
const multiplayerModal = document.querySelector('#multiplayerModal');
function launchMultiplayer(code) { connectRoom(code); document.querySelector('#menu').classList.add('hidden'); document.querySelector('#gameShell').classList.remove('hidden'); document.querySelector('#start').classList.remove('hidden'); beginWorld(true); }
document.querySelector('#multiplayerButton').onclick = () => launchMultiplayer(Math.random().toString(36).slice(2, 8).toUpperCase());
document.querySelector('#joinMenuButton').onclick = () => multiplayerModal.classList.remove('hidden');
document.querySelector('#gameSettingsButton').onclick = () => gameSettingsModal.classList.remove('hidden');
document.querySelectorAll('[data-game-close]').forEach(button => button.onclick = () => document.querySelector(`#${button.dataset.gameClose}`).classList.add('hidden'));
document.querySelector('#createRoom').onclick = () => { const code = (document.querySelector('#roomCode').value.trim() || Math.random().toString(36).slice(2, 8)).toUpperCase(); document.querySelector('#roomCode').value = code; launchMultiplayer(code); };
document.querySelector('#joinRoom').onclick = () => { const code = document.querySelector('#roomCode').value.trim().toUpperCase(); if (!/^[A-Z0-9]{4,10}$/.test(code)) return setRoomStatus('Enter a 4-10 character room code.'); launchMultiplayer(code); };
document.querySelector('#gameSensitivity').oninput = event => { gameSettings.sensitivity = Number(event.target.value); applyGameSettings(); };
document.querySelector('#gameFov').oninput = event => { gameSettings.fov = Number(event.target.value); applyGameSettings(); };
document.querySelector('#gameInvertY').onchange = event => { gameSettings.invertY = event.target.checked; };
document.querySelector('#gameQuality').onchange = event => { gameSettings.quality = event.target.value; applyGameSettings(); };
document.querySelector('#skinSelect').onchange = event => { gameSettings.skin = event.target.value; if (multiplayerChannel) roomMessage({ type: 'position', x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, skin: gameSettings.skin }); };
function addChatMessage(name, text, broadcast = true) { const message = document.createElement('p'); const author = document.createElement('strong'); author.textContent = `${name}: `; message.append(author, document.createTextNode(text)); document.querySelector('#chatMessages').append(message); document.querySelector('#chatMessages').scrollTop = document.querySelector('#chatMessages').scrollHeight; if (broadcast) roomMessage({ type: 'chat', name: 'You', text }); }
function toggleChat() { const panel = document.querySelector('#chatPanel'); panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) document.querySelector('#chatInput').focus(); }
document.querySelector('#chatToggle').onclick = toggleChat;
document.querySelector('#chatClose').onclick = () => document.querySelector('#chatPanel').classList.add('hidden');
document.querySelector('#chatForm').onsubmit = event => { event.preventDefault(); const input = document.querySelector('#chatInput'); const text = input.value.trim(); if (!text) return; addChatMessage('You', text); input.value = ''; };
addEventListener('keydown', event => { if (event.code === 'KeyT' && started && document.activeElement !== document.querySelector('#chatInput')) { event.preventDefault(); toggleChat(); } });
