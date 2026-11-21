import { MAPS, advance, createMatch, decisionView, getStats, prepareTurn, submitOrders, validateOrder } from './engine.js';
import { openBot } from './bot-runner.js';
import { createRecording } from './recording.js';

export const PROTOCOL = 'SG-JS/2';
export const RULESET = 'siege-grid/2';
export const SUITE = 'standard-18/2';
export const BUDGET_MS = 250;
export const SOURCE_LIMIT = 32768;
const SEEDS = ['2407','2544','2681'];
const MAP_IDS = ['basin','ridge','delta'];

export const TRIALS = Object.freeze(MAP_IDS.flatMap(mapId => SEEDS.flatMap(seed => [false,true]
  .map(swapped => Object.freeze({ mapId,seed,swapped })))));

export const CHALLENGE_PROMPT = `# 城域竞技场 · JavaScript 算法挑战

你是参赛选手。请为下面这款回合制游戏编写尽可能强的策略。你的代码会在同一评测套件中和另一份 AI 生成的代码对弈。

## 提交格式
- 接口 ${PROTOCOL}，规则版本 ${RULESET}，评测套件 ${SUITE}。
- 只输出一段原始 JavaScript 源码，第一行从 function decide(state, team) { 开始；必要时可在其后定义辅助函数。无需解释、Markdown 围栏、文件名、import、export 或依赖。网页也兼容一层 js / javascript 代码围栏。
- 实现同步函数 decide(state, team)。返回普通对象 { from, to, units }（三个字段均为安全整数），或直接返回 null 表示本回合等待。不可返回 Promise、数组、undefined 或额外字段。
- 源码最多 ${SOURCE_LIMIT} 个 UTF-16 代码单元。每回合响应预算 ${BUDGET_MS} ms（浏览器来回传输也计入）。代码会在独立 Worker 中执行，禁止网络、模块加载、存储、浏览器界面 API、时间和系统随机数。可仅用输入派生确定性种子。
- 同样的输入须返回同样的输出。每次调用从头初始化函数，不要写入全局状态、不改写内置对象、不依赖上回合缓存。把战局视为只读。可以从本局数据计算、搜索和前瞻，注意预算。两边使用同一接口和时限。

## 输入字段
- team 为 1（蓝）或 2（红），对手编号为 3 - team。owner 为 0（中立）、1 或 2。
- state.turn：当前回合，从 1 开始，回合数没有上限。state.seed：字符串。state.mapId：地图 ID。
- state.nodes：据点数组，可用 ID 做索引。每项包含 { id, x, y, name, kind, owner, units, rate }。x、y 为地图坐标，name 为显示名称，kind 为 base／city／town／post，units 为驻军，rate 为每回合产能。
- state.neighbors[id]：与据点 id 直接相连的通路数组，每项 { id, time }，id 为终点编号，time 为行军所需回合。通路是双向的。
- state.bases：数组 [null, 蓝方原始要塞ID, 红方原始要塞ID]。
- state.fleets：在途部队数组。每项 { id, team, from, to, units, launch, arrival }，launch 与 arrival 是出发和抵达的回合编号。双方部队均可见。
- from 必须是本方当前占领的据点 ID；to 必须直接相邻，可以是友方、中立或敌方据点；units 的范围为 1 到起点当前驻军减 1。每方每回合最多下一道命令。

## 回合顺序与胜负
1. 各方已占领的据点先增加 rate 单位，最多储存 360。中立据点无自动增长。初始双方各一座 28 驻军的要塞；其他据点中立。
2. 本回合抵达的军队与驻军一起结算。各阵营在同一据点的兵力先分别相加。若最大一方的兵力大于其余阵营之和，该方获得据点，驻军等于差值；否则保留原归属，驻军归零。友方增援直接计入己方兵力。
3. 占领对方的原始要塞即获胜，同回合互占则平局。双方可持续对战。人工中止的对局记为未完赛，零散领先数据不用于判定胜负。
4. 尚未结束时，双方读取同一份结算后快照并同时下令。出发时扣除起点驻军，在 turn + time 抵达。对手本回合的命令在当前决策时不可见。

## 评测条件
- 单局模式可选择地图、种子和阵营。
- 标准测评地图：${MAP_IDS.map(id => MAPS[id].name + '（' + id + '）').join('、')}。
- 标准测评固定种子：${SEEDS.join('、')}。每张地图、每个种子各打一对换边赛：先 A 蓝 B 红，再 B 蓝 A 红，共 ${TRIALS.length} 局。
- 提交前会在两种阵营和不同局面运行接口预检。预检失败需要修正代码后再参评。
- 正式对局若单方返回非法命令、抛出异常或超时，判该方负；同一回合双方均出错，判平。浏览器运行器不可用则停止测评。
- 目标是提高固定赛制下的获胜局数，并写出能处理不同合法战局的策略。重视驻军、产能、行军时差、在途部队和要塞风险。只输出可直接粘贴运行的完整 JavaScript。`;

export const SAMPLE = `function decide(state, team) {
  const { nodes, neighbors, bases, fleets } = state;
  const enemy = 3 - team;
  const enemyBase = bases[enemy];
  const distance = nodes.map(() => Infinity);
  const frontier = nodes.map(node => neighbors[node.id].some(route => nodes[route.id].owner !== team));
  distance[enemyBase] = 0;
  const queue = [enemyBase];
  for (const node of queue) {
    for (const route of neighbors[node]) {
      if (distance[route.id] !== Infinity) continue;
      distance[route.id] = distance[node] + 1;
      queue.push(route.id);
    }
  }

  let best = null;
  let bestValue = 0;
  for (const origin of nodes) {
    if (origin.owner !== team) continue;
    const threat = fleets.filter(fleet => fleet.team === enemy && fleet.to === origin.id)
      .reduce((sum,fleet) => sum + fleet.units,0);
    const available = origin.units - 5 - Math.min(threat,origin.units);
    if (available < 8) continue;

    for (const route of neighbors[origin.id]) {
      const target = nodes[route.id];
      const arriving = fleets.filter(fleet => fleet.to === target.id);
      const attacking = arriving.filter(fleet => fleet.team === team)
        .reduce((sum,fleet) => sum + fleet.units,0);
      const hostile = arriving.filter(fleet => fleet.team === enemy)
        .reduce((sum,fleet) => sum + fleet.units,0);
      let units, value;
      if (target.owner === team) {
        if (distance[target.id] >= distance[origin.id] || !frontier[target.id]) continue;
        const space = 360 - target.units - attacking - route.time * target.rate;
        if (space < 25 || available < 28) continue;
        units = Math.min(available,space);
        value = 12 + units * .35 + (distance[target.id] === 1 ? 55 : 0);
      } else {
        const defense = Math.min(360,target.units + (target.owner ? target.rate * route.time : 0)) + hostile - attacking;
        if (defense < 0) continue;
        if (target.id === enemyBase && available >= 45) {
          units = available;
          value = 210 + available * .55 - route.time * 3;
        } else if (available > defense) {
          units = Math.min(available,defense + 8 + Math.floor(available * .2));
          value = 75 + target.rate * 12 - distance[target.id] * 6 - defense * .24 - route.time * 4;
        } else if (target.owner === enemy && available >= 45 && available >= defense * .28) {
          units = available;
          value = 32 + available * .25 - distance[target.id] * 3 - route.time * 4;
        } else {
          continue;
        }
      }
      if (value > bestValue) {
        best = { from:origin.id, to:target.id, units };
        bestValue = value;
      }
    }
  }
  return best;
}`;

export const DEFENSIVE_SAMPLE = `function decide(state, team) {
  const base = state.nodes[state.bases[team]];
  let best = null;
  let bestValue = -Infinity;
  for (const origin of state.nodes) {
    if (origin.owner !== team) continue;
    const reserve = origin.id === base.id ? 13 : 8;
    for (const route of state.neighbors[origin.id]) {
      const target = state.nodes[route.id];
      if (target.owner === team) continue;
      const arrivals = state.fleets.filter(fleet => fleet.to === target.id &&
        fleet.arrival <= state.turn + route.time);
      if (arrivals.some(fleet => fleet.team === team)) continue;
      const hostile = arrivals.reduce((total, fleet) => total + fleet.units, 0);
      const units = target.units + hostile + 6 + (target.owner ? target.rate * route.time : 0);
      if (units > origin.units - reserve) continue;
      const value = 18 * target.rate - 2 * route.time - units +
        (target.id === state.bases[3 - team] ? 60 : 0);
      if (value > bestValue) {
        best = { from: origin.id, to: target.id, units };
        bestValue = value;
      }
    }
  }
  return best;
}`;

export function normalizeSource(raw) {
  let source = raw.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (source.startsWith(fence)) {
    const lines = source.split(/\r?\n/);
    const language = lines[0].slice(3).trim().toLowerCase();
    if (!['','js','javascript'].includes(language) || lines.at(-1).trim() !== fence) {
      throw new Error('请粘贴原始 JavaScript，或保留一层完整的 JavaScript 代码围栏');
    }
    source = lines.slice(1,-1).join('\n').trim();
  }
  if (!source) throw new Error('请粘贴参赛代码');
  if (source.length > SOURCE_LIMIT) throw new Error('代码超过 ' + SOURCE_LIMIT + ' 个 UTF-16 单位');
  return source;
}

async function ask(bot, state, team) {
  if (bot.fault) return { fault:bot.fault };
  const reply = await bot.decide(decisionView(state),team);
  const fault = reply.fault || validateOrder(state,reply.order,team);
  return fault ? { fault } : { order:reply.order };
}

export async function checkSubmission(source, signal) {
  const bot = await openBot(source,BUDGET_MS,signal);
  try {
    if (bot.fault) return { fault:bot.fault };
    let checks = 0;
    for (const mapId of MAP_IDS) {
      let state = createMatch({ mapId,seed:SEEDS[0] });
      const opening = prepareTurn(state);
      for (let turn = 0; turn < 12; turn++) state = advance(state);
      for (const sample of [opening,prepareTurn(state)]) {
        for (const team of [1,2]) {
          const { fault } = await ask(bot,sample,team);
          if (fault) {
            const side = team === 1 ? '蓝方' : '红方';
            return { fault:MAPS[mapId].name + ' · 第 ' + sample.turn + ' 回合 · ' + side + ' · ' + fault };
          }
          checks++;
        }
      }
    }
    return { checks };
  } finally {
    bot.close();
  }
}

export async function challengeMatch(trial, entrants, { signal, onTurn } = {}) {
  const { mapId,seed,swapped } = trial;
  const pair = swapped ? [entrants[1],entrants[0]] : entrants;
  let state = createMatch({ mapId,seed });
  const recording = createRecording(state);
  const names = pair.map(entrant => entrant.name);
  let faults = [];
  let stopped = false;
  onTurn?.(state,names);
  const opened = await Promise.allSettled(pair.map(({ source }) => openBot(source,BUDGET_MS,signal)));
  const bots = opened.map(result => result.status === 'fulfilled' ? result.value : null);
  try {
    const failure = opened.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    while (state.winner === null) {
      signal?.throwIfAborted();
      const next = prepareTurn(state);
      let orders = null;
      if (next.winner === null) {
        const replies = await Promise.all(bots.map((bot,index) => ask(bot,next,index+1)));
        faults = replies.flatMap(({ fault },index) => fault ? [{ team:index+1,detail:fault }] : []);
        if (faults.length) {
          next.winner = faults.length === 2 ? 0 : 3 - faults[0].team;
          next.endReason = faults.length === 2 ? '双方同回合提交出错' : '对方提交出错';
        } else {
          orders = replies.map(reply => reply.order);
          submitOrders(next,orders);
        }
      }
      recording.append(next,orders);
      state = next;
      onTurn?.(state,names);
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
    stopped = true;
  } finally {
    for (const bot of bots) bot?.close();
  }
  const winner = state.winner && swapped ? 3 - state.winner : state.winner;
  return {
    ...trial, winner, turn:state.turn, reason:stopped ? '手动中止 · 未完赛' : state.endReason,
    statsBlueRed:getStats(state).slice(1), names, recording,
    faults:faults.map(({ team,detail }) => ({ entrant:(team === 1) !== swapped ? 'A' : 'B', detail }))
  };
}

export async function fingerprint(source) {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}
