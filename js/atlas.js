import { WIDTH, HEIGHT, hash, random } from './engine.js';

const COLORS = { 1: '#65d9f7', 2: '#ff856e' };
const LABELS = {
  basin: [[150,71,'北 环 高 地'], [555,95,'断 脊 山 链'], [240,508,'下 游 平 原'], [787,470,'赤 崖 台 地']],
  ridge: [[155,85,'西 侧 高 地'], [540,77,'灰 冠 主 峰'], [290,514,'南 麓 谷 地'], [795,486,'东 侧 高 地']],
  delta: [[133,69,'外 海'], [500,61,'风 帆 海 峡'], [250,506,'浅 滩 湾'], [790,480,'南 潮 水 道']]
};

function noise(x, y, salt) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  const fx = x - col;
  const fy = y - row;
  const smoothX = fx * fx * (3 - 2 * fx);
  const smoothY = fy * fy * (3 - 2 * fy);
  const value = (a,b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + salt | 0;
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  const top = value(col,row) + (value(col+1,row) - value(col,row)) * smoothX;
  const bottom = value(col,row+1) + (value(col+1,row+1) - value(col,row+1)) * smoothX;
  return top + (bottom - top) * smoothY;
}

function terrain(mapId, seed, nodes) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const salt = hash(mapId + seed);
  const rng = random(salt);
  const sizeX = 640;
  const sizeY = 364;
  const elevations = new Float32Array(sizeX * sizeY);
  const mountains = mapId === 'ridge' ? .47 : .31;

  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
      const u = x / sizeX;
      const v = y / sizeY;
      const folded = 1 - Math.abs(2 * noise(u * 7, v * 6, salt) - 1);
      const rough = .52 * noise(u * 5, v * 4, salt + 13) + .2 * noise(u * 13, v * 10, salt + 29)
        + .11 * noise(u * 27, v * 17, salt + 61) + .055 * noise(u * 83, v * 41, salt + 3);
      const spine = Math.exp(-Math.abs(v - (.32 + .2 * Math.sin(u * 5))) * 7);
      let altitude = rough + spine * folded ** 3 * mountains;
      if (mapId === 'delta') {
        const nearest = Math.min(...nodes.map(node => Math.hypot(u - node.x / WIDTH, (v - node.y / HEIGHT) * .92)));
        altitude = altitude * .68 + Math.max(0, .28 - nearest * 2.0);
      }
      elevations[y * sizeX + x] = altitude;
    }
  }

  const buffer = document.createElement('canvas');
  buffer.width = sizeX;
  buffer.height = sizeY;
  const bufferContext = buffer.getContext('2d');
  const pixels = bufferContext.createImageData(sizeX, sizeY);
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
      const i = y * sizeX + x;
      const h = elevations[i];
      const down = elevations[Math.min(i+sizeX,elevations.length-1)];
      const right = elevations[Math.min(i+1,elevations.length-1)];
      const shade = Math.max(-14, Math.min(22, (h - down) * 470 + (h - right) * 340));
      const contour = Math.floor(h * 30) !== Math.floor(down * 30) || Math.floor(h * 30) !== Math.floor(right * 30);
      const waterLevel = mapId === 'delta' ? .35 : .235;
      const water = h < waterLevel;
      const coast = water && (down > waterLevel || right > waterLevel);
      const texture = (rng() - .5) * 4;
      const value = water ? 9 + texture + (coast ? 13 : 0) : 13 + h * 28 + shade + (contour ? 5 : 0) + texture;
      const palette = water ? [1.2,10,19] : [0,10,13];
      for (let k = 0; k < 3; k++) pixels.data[i * 4 + k] = value + palette[k];
      pixels.data[i * 4 + 3] = 255;
    }
  }
  bufferContext.putImageData(pixels, 0, 0);
  ctx.drawImage(buffer, 0, 0, WIDTH, HEIGHT);

  const grid = 40;
  ctx.strokeStyle = '#b4d9e51b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 20; x < WIDTH; x += grid) {
    ctx.moveTo(x + .5, 0);
    ctx.lineTo(x + .5, HEIGHT);
  }
  for (let y = 23; y < HEIGHT; y += grid) {
    ctx.moveTo(0, y + .5);
    ctx.lineTo(WIDTH, y + .5);
  }
  ctx.stroke();

  const vignette = ctx.createRadialGradient(500,284,86,500,284,608);
  vignette.addColorStop(0,'#080f1600');
  vignette.addColorStop(1,'#070e18bc');
  ctx.fillStyle = vignette;
  ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle = '#abc5d47c';
  ctx.font = '600 12px system-ui';
  ctx.textAlign = 'center';
  for (const [x,y,name] of LABELS[mapId]) ctx.fillText(name,x,y);
  return canvas;
}

export class Atlas {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.key = '';
  }

  draw(state, selected, phase) {
    const key = state.mapId + ':' + state.seed;
    if (key !== this.key) {
      this.backdrop = terrain(state.mapId, state.seed, state.nodes);
      this.key = key;
    }
    const ctx = this.context;
    ctx.drawImage(this.backdrop, 0, 0);
    const nodes = state.nodes;

    for (const node of nodes) {
      if (node.owner === 0) continue;
      const radius = node.kind === 'base' ? 204 : 123;
      const glow = ctx.createRadialGradient(node.x,node.y,0,node.x,node.y,radius);
      glow.addColorStop(0,COLORS[node.owner] + '24');
      glow.addColorStop(1,COLORS[node.owner] + '00');
      ctx.fillStyle = glow;
      ctx.fillRect(node.x - radius,node.y - radius,radius*2,radius*2);
    }
    for (const { a:from, b:to } of state.edges) {
      const a = nodes[from];
      const b = nodes[to];
      const active = from === selected || to === selected;
      const owned = a.owner && a.owner === b.owner;
      ctx.strokeStyle = active ? '#d4e9f4b9' : owned ? COLORS[a.owner] + '96' : '#b6d0d765';
      ctx.lineWidth = active ? 2 : 1.45;
      ctx.setLineDash(owned ? [] : [4,5]);
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const fleet of state.fleets) {
      const a = nodes[fleet.from];
      const b = nodes[fleet.to];
      const t = Math.max(.12, Math.min(.93, (state.turn - fleet.launch + phase) / (fleet.arrival - fleet.launch)));
      const angle = Math.atan2(b.y-a.y,b.x-a.x);
      const offset = fleet.team === 1 ? -3 : 3;
      const x = a.x + (b.x - a.x) * t - Math.sin(angle) * offset;
      const y = a.y + (b.y - a.y) * t + Math.cos(angle) * offset;
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(angle);
      ctx.strokeStyle = COLORS[fleet.team] + '75';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20,0);
      ctx.lineTo(0,0);
      ctx.stroke();
      ctx.fillStyle = COLORS[fleet.team];
      ctx.shadowColor = COLORS[fleet.team];
      ctx.shadowBlur = 11;
      ctx.beginPath();
      ctx.moveTo(6,0);
      ctx.lineTo(-3,-4);
      ctx.lineTo(-2,0);
      ctx.lineTo(-3,4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
