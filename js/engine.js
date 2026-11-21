import { STRATEGIES, chooseMove } from './strategies.js';

export const WIDTH = 1000;
export const HEIGHT = 568;
export const TURN_LIMIT = 140;
export const TEAMS = { 1: '蓝方', 2: '红方' };
export const MAPS = {
  basin: {
    name: '断脊盆地', subtitle: '中央枢纽 · 双翼通路', mark: '01',
    places: [
      [107, 280, '青岬要塞', 'base'], [230, 141, '北环前站', 'town'],
      [251, 412, '苔原渡口', 'town'], [375, 101, '雾松岗', 'post'],
      [315, 285, '苍岩门', 'town'], [405, 414, '沉沙湾', 'city'],
      [457, 205, '霜河站', 'town']
    ],
    opposite: ['赤崖要塞', '南环前站', '铁杉渡口', '风鸣岭', '熔岩门', '落星湾', '炎河站'],
    center: ['断脊城', 'city'], local: [[0,1],[0,2],[0,4],[1,3],[1,4],[2,4],[2,5],[3,6],[4,5],[4,6]],
    cross: [[3,5]], hub: [4,6]
  },
  ridge: {
    name: '灰冠山脉', subtitle: '狭窄山口 · 密集城镇', mark: '02',
    places: [
      [105, 385, '云阶要塞', 'base'], [210, 242, '晨谷城', 'city'],
      [270, 464, '悬桥哨', 'post'], [327, 125, '白桦城', 'city'],
      [340, 302, '银矿站', 'town'], [440, 442, '回音谷', 'town'],
      [454, 208, '穹岩口', 'post']
    ],
    opposite: ['夜峰要塞', '暮谷城', '黑岩哨', '红杉城', '铁矿站', '长风谷', '灰石口'],
    center: ['灰冠隘口', 'town'], local: [[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,6],[4,5]],
    cross: [[3,5]], hub: [6]
  },
  delta: {
    name: '银湾群岛', subtitle: '多线交汇 · 岛链枢纽', mark: '03',
    places: [
      [98, 206, '北潮要塞', 'base'], [227, 109, '白沙港', 'city'],
      [231, 366, '浅滩岛', 'town'], [365, 81, '鹭湾哨', 'post'],
      [347, 252, '回浪港', 'town'], [395, 435, '南盐屿', 'city'],
      [468, 150, '风帆渡', 'post']
    ],
    opposite: ['南潮要塞', '黑沙港', '珊瑚岛', '鲸湾哨', '望海港', '北盐屿', '灯塔渡'],
    center: ['银湾中港', 'city'], local: [[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,5],[4,6]],
    cross: [[3,5],[5,5]], hub: [4,5,6]
  }
};

const INCOME = { base: 3, city: 3, town: 2, post: 1 };
const START = { base: 28, city: 12, town: 7, post: 5 };

export function hash(value) {
  let number = 2166136261;
  for (const character of String(value)) {
    number = Math.imul(number ^ character.codePointAt(0), 16777619);
  }
  return number >>> 0;
}

export function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(value ^ value >>> 15, value | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

function createBoard(mapId, seed) {
  const map = MAPS[mapId];
  const rand = random(hash(mapId + ':' + seed));
  const left = map.places.map(([x, y, name, kind], id) => ({
    id, x, y, name, kind, owner: id === 0 ? 1 : 0, rate: INCOME[kind],
    units: START[kind] + (id ? Math.floor(rand() * 5) : 0)
  }));
  const count = left.length;
  const nodes = [...left, ...left.map(node => ({
    ...node, id: node.id + count, x: WIDTH - node.x, y: HEIGHT - node.y,
    name: map.opposite[node.id], owner: node.id === 0 ? 2 : 0
  })), {
    id: count * 2, x: WIDTH / 2, y: HEIGHT / 2, name: map.center[0],
    kind: map.center[1], owner: 0, rate: INCOME[map.center[1]],
    units: START[map.center[1]] + 6
  }];
  const routes = new Map();
  function add(a, b) {
    const key = [a, b].sort((x, y) => x - y).join('-');
    const distance = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
    routes.set(key, { a, b, time: Math.max(2, Math.ceil(distance / 87)) });
  }
  for (const [a,b] of map.local) {
    add(a,b);
    add(a + count,b + count);
  }
  for (const [a,b] of map.cross) {
    add(a,b + count);
    add(b,a + count);
  }
  for (const a of map.hub) {
    add(a,count * 2);
    add(a + count,count * 2);
  }
  const edges = [...routes.values()];
  const neighbors = nodes.map(() => []);
  for (const { a,b,time } of edges) {
    neighbors[a].push({ id:b, time });
    neighbors[b].push({ id:a, time });
  }
  return { nodes, edges, neighbors, bases: [null, 0, count] };
}

export function createMatch({ mapId = 'basin', seed = '2407', blue = 'expand', red = 'raid', custom } = {}) {
  const { nodes, edges, neighbors, bases } = createBoard(mapId, seed);
  return {
    nodes, edges, neighbors, bases, mapId, seed, blue, red, custom,
    turn: 0, winner: null, endReason: '', fleets: [], events: [], nextFleet: 1
  };
}

export function getStats(state) {
  const sides = [null, { land: 0, units: 0, income: 0 }, { land: 0, units: 0, income: 0 }];
  for (const node of state.nodes) {
    if (node.owner === 0) continue;
    const side = sides[node.owner];
    side.land++;
    side.units += node.units;
    side.income += node.rate;
  }
  for (const fleet of state.fleets) sides[fleet.team].units += fleet.units;
  return sides;
}

export function score(state) {
  const stats = getStats(state);
  return [null, ...stats.slice(1).map(side => (
    side.land * 30 + side.income * 8 + side.units
  ))];
}

function checkWinner(state) {
  const lostBlue = state.nodes[state.bases[1]].owner === 2;
  const lostRed = state.nodes[state.bases[2]].owner === 1;
  if (lostBlue || lostRed) {
    state.winner = lostBlue && lostRed ? 0 : lostBlue ? 2 : 1;
    state.endReason = state.winner ? '占领敌方要塞' : '双方同时占领对方要塞';
  } else if (state.turn >= TURN_LIMIT) {
    const [,blue,red] = score(state);
    state.winner = blue === red ? 0 : blue > red ? 1 : 2;
    state.endReason = '达到回合上限 · 按积分结算';
  }
}

export function validateOrder(state, order, team) {
  if (order == null) return '';
  const { from, to, units } = order;
  if (![from, to, units].every(Number.isSafeInteger)) return 'from、to 与 units 必须为整数';
  const origin = state.nodes[from];
  if (!origin || origin.owner !== team) return '起点必须是本方据点';
  if (!state.neighbors[from].some(edge => edge.id === to)) return '起点和终点必须由通路直接相连';
  if (units < 1 || units >= origin.units) return '出兵至少 1，起点须保留至少 1 个单位';
  return '';
}

function sendFleet(state, order, team) {
  if (!order || validateOrder(state, order, team)) return;
  const { from, to, units } = order;
  const origin = state.nodes[from];
  const route = state.neighbors[from].find(edge => edge.id === to);
  origin.units -= units;
  state.fleets.push({
    id: state.nextFleet++, team, from, to, units, launch: state.turn, arrival: state.turn + route.time
  });
  state.events.push({ type:'move', turn:state.turn, team, from, to, units });
}

function resolveArrivals(state) {
  const arrivals = new Map();
  const traveling = [];
  for (const fleet of state.fleets) {
    if (fleet.arrival > state.turn) {
      traveling.push(fleet);
      continue;
    }
    if (!arrivals.has(fleet.to)) arrivals.set(fleet.to, [0,0,0]);
    arrivals.get(fleet.to)[fleet.team] += fleet.units;
  }
  state.fleets = traveling;
  for (const [id, forces] of arrivals) {
    const node = state.nodes[id];
    const prior = node.owner;
    forces[prior] += node.units;
    const ranked = [0,1,2].sort((a,b) => forces[b] - forces[a]);
    const [largest, middle, smallest] = ranked;
    const survivors = forces[largest] - forces[middle] - forces[smallest];
    node.units = Math.max(0, survivors);
    if (survivors > 0) node.owner = largest;
    if (node.owner !== prior) {
      state.events.push({ type:'capture', turn:state.turn, team:node.owner, prior, to:id });
    } else if (forces.some((units, side) => side !== prior && units > 0)) {
      state.events.push({ type:'hold', turn:state.turn, team:prior, to:id });
    }
  }
}

export function prepareTurn(previous) {
  if (previous.winner !== null) return previous;
  const state = {
    ...previous, turn: previous.turn + 1, events: [],
    nodes: previous.nodes.map(node => ({ ...node })), fleets: [...previous.fleets]
  };
  for (const node of state.nodes) {
    if (node.owner) node.units = Math.min(360, node.units + node.rate);
  }
  resolveArrivals(state);
  checkWinner(state);
  return state;
}

export function decisionView({ turn, seed, mapId, nodes, neighbors, bases, fleets }) {
  return { turn, turnLimit: TURN_LIMIT, seed, mapId, nodes, neighbors, bases, fleets };
}

export function submitOrders(state, orders) {
  if (state.winner !== null) return state;
  sendFleet(state, orders[0], 1);
  sendFleet(state, orders[1], 2);
  return state;
}

export function advance(previous, bots = {}) {
  const state = prepareTurn(previous);
  if (state.winner !== null) return state;
  const view = decisionView(state);
  const orders = [state.blue, state.red].map((id, index) => {
    const strategy = id === 'custom' ? state.custom ?? STRATEGIES.custom : STRATEGIES[id];
    if (typeof bots[id] === 'function') return bots[id](structuredClone(view), index + 1);
    return chooseMove(view, index + 1, strategy ?? STRATEGIES.expand);
  });
  return submitOrders(state, orders);
}

export function simulate(config, bots) {
  let state = createMatch(config);
  while (state.winner === null) state = advance(state, bots);
  return state;
}
