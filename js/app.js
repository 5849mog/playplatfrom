import { WIDTH, HEIGHT, MAPS, TEAMS, createMatch, advance, simulate, getStats, score } from './engine.js';
import { STRATEGIES, PARAMETERS } from './strategies.js';
import { Atlas } from './atlas.js';

const $ = id => document.getElementById(id);
const atlas = new Atlas($('atlas'));
const blue = $('blue');
const red = $('red');
const mapSelect = $('map-select');
const seed = $('seed');
const timeline = $('timeline');
const speed = $('speed');
const play = $('play');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const kindNames = { base:'要塞', city:'城市', town:'城镇', post:'前哨' };
const custom = { ...STRATEGIES.custom };
const getName = id => STRATEGIES[id].name;
let history = [];
let position = 0;
let selected = null;
let playing = false;
let lastTick = 0;
let animation = 0;
let view = 'arena';
let markers = [];

function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label != null) node.textContent = label;
  return node;
}

function options(select, entries) {
  for (const [id,value] of Object.entries(entries)) select.append(new Option(value.name,id));
}
for (const select of [blue,red,$('series-a'),$('series-b')]) options(select,STRATEGIES);
options(mapSelect,MAPS);
options($('series-map'),MAPS);
red.value = $('series-b').value = 'raid';

for (const [key,label] of Object.entries(PARAMETERS)) {
  const row = element('label');
  const input = element('input');
  const output = element('output', '', custom[key]);
  input.type = 'range';
  input.id = 'weight-' + key;
  input.min = 1;
  input.max = 10;
  input.value = custom[key];
  output.htmlFor = input.id;
  input.addEventListener('input', () => {
    custom[key] = Number(input.value);
    output.value = input.value;
  });
  row.append(element('span','',label),input,output);
  $('weights').append(row);
}

const meterRows = Object.fromEntries([
  ['land','控制据点'], ['units','总兵力'], ['income','每回合产能']
].map(([key,label]) => {
  const row = element('div','meter');
  const labels = element('div','meter-labels');
  const bar = element('div','meter-bar');
  bar.setAttribute('aria-hidden','true');
  const values = [element('b'),element('b')];
  const fills = [element('span'),element('span')];
  labels.append(values[0],element('span','',label),values[1]);
  bar.append(...fills);
  row.append(labels,bar);
  $('meters').append(row);
  return [key,{ values,fills }];
}));

function updateStrategyNotes() {
  $('blue-desc').textContent = STRATEGIES[blue.value].description;
  $('red-desc').textContent = STRATEGIES[red.value].description;
  $('custom-editor').hidden = blue.value !== 'custom' && red.value !== 'custom';
}
blue.addEventListener('change', updateStrategyNotes);
red.addEventListener('change', updateStrategyNotes);
$('swap').addEventListener('click', () => {
  [blue.value,red.value] = [red.value,blue.value];
  updateStrategyNotes();
});
$('roll').addEventListener('click', () => {
  seed.value = String(Math.floor(Math.random() * 90000) + 10000);
  seed.setCustomValidity('');
});
seed.addEventListener('input', () => seed.setCustomValidity(''));
updateStrategyNotes();

function configFromForm() {
  return { blue:blue.value, red:red.value, mapId:mapSelect.value, seed:seed.value.trim(), custom:{ ...custom } };
}

function renderMarkers(state) {
  const container = $('nodes');
  markers = state.nodes.map(node => {
    const button = element('button','node');
    const number = element('span','node-marker');
    button.type = 'button';
    button.dataset.kind = node.kind;
    button.dataset.label = node.y < 165 ? 'up' : 'down';
    button.style.left = node.x / WIDTH * 100 + '%';
    button.style.top = node.y / HEIGHT * 100 + '%';
    button.append(number,element('span','node-name',node.name));
    button.addEventListener('click', () => {
      selected = selected === node.id ? null : node.id;
      renderSites(history[position]);
      if (!playing) atlas.draw(history[position],selected,0);
    });
    return { button,number };
  });
  container.replaceChildren(...markers.map(item => item.button));
}

function renderSites(state) {
  for (const node of state.nodes) {
    const { button,number } = markers[node.id];
    const active = node.id === selected;
    const owner = TEAMS[node.owner] ?? '中立';
    button.dataset.owner = node.owner;
    button.classList.toggle('selected',active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', node.name + '，' + owner + '，驻军 ' + node.units);
    number.textContent = node.units;
  }
  const node = state.nodes[selected];
  $('site-detail').textContent = node
    ? [node.name,kindNames[node.kind],TEAMS[node.owner] ?? '中立','驻军 ' + node.units,'产能 +' + node.rate].join(' · ')
    : '点击据点查看驻军';
}

function renderEvents(state) {
  const rows = [];
  for (let turn = position; turn > 0 && rows.length < 20; turn--) {
    const events = history[turn].events;
    for (const event of [...events].reverse()) {
      const side = TEAMS[event.team] ?? '守军';
      const target = state.nodes[event.to].name;
      let label = side + '占领' + target;
      if (event.type === 'hold') label = side + '守住' + target;
      if (event.type === 'move') label = side + '从' + state.nodes[event.from].name + '派出 ' + event.units + ' 兵力前往' + target;
      const row = element('li');
      row.dataset.team = event.team;
      row.append(element('time','',String(turn).padStart(3,'0')),element('i'),element('span','',label));
      rows.push(row);
      if (rows.length === 20) break;
    }
  }
  $('event-meta').textContent = state.turn ? '截至第 ' + state.turn + ' 回合' : '等待对战开始';
  $('events-list').replaceChildren(...(rows.length ? rows : [element('li','empty','据点易主和出兵记录会显示在这里。')]));
}

function renderMeters(state) {
  const stats = getStats(state);
  for (const [key,{ values,fills }] of Object.entries(meterRows)) {
    const sides = [stats[1][key],stats[2][key]];
    const total = sides[0] + sides[1];
    for (let i = 0; i < 2; i++) {
      values[i].textContent = sides[i];
      fills[i].style.width = (total ? sides[i] / total * 100 : 0) + '%';
    }
  }
  const result = $('match-result');
  result.hidden = state.winner === null;
  if (!result.hidden) {
    const [,blueScore,redScore] = score(state);
    const winner = state.winner === 0 ? '平局' : TEAMS[state.winner] + '获胜';
    result.textContent = winner + ' · ' + state.endReason + ' · ' + blueScore + ' 比 ' + redScore + ' 分';
  }
}

function render() {
  const state = history[position];
  const end = state.winner !== null;
  const historical = position < history.length - 1;
  $('turn').textContent = String(position).padStart(3,'0');
  const status = $('match-status');
  status.className = 'status' + (end ? ' finished' : playing ? ' live' : '');
  status.textContent = end ? '已结束' : historical ? '回放中' : playing ? '对战中' : position ? '已暂停' : '待开局';
  play.firstElementChild.textContent = playing ? 'Ⅱ' : end ? '⟳' : '▶';
  play.lastElementChild.textContent = playing ? '暂停' : end ? '重播' : historical ? '继续回放' : position ? '继续对战' : '开始对战';
  $('step').disabled = end;
  timeline.max = history.length - 1;
  timeline.value = position;
  timeline.disabled = history.length === 1;
  timeline.setAttribute('aria-valuetext','第 ' + position + ' 回合，共 ' + (history.length - 1) + ' 个已记录回合');
  renderSites(state);
  renderMeters(state);
  renderEvents(state);
  atlas.draw(state,selected,0);
}

function stop() {
  playing = false;
  cancelAnimationFrame(animation);
}

function setMatch(frames) {
  stop();
  history = frames;
  position = 0;
  selected = null;
  const state = history[0];
  const map = MAPS[state.mapId];
  $('battle-name').textContent = map.name;
  $('battle-subtitle').textContent = map.subtitle;
  $('map-index').textContent = map.mark;
  $('active-seed').textContent = state.seed;
  $('active-seed').title = state.seed;
  $('blue-name').textContent = getName(state.blue);
  $('red-name').textContent = getName(state.red);
  renderMarkers(state);
  render();
}

function step() {
  if (position === history.length - 1) {
    const current = history[position];
    if (current.winner !== null) return;
    history.push(advance(current));
  }
  position++;
  if (history[position].winner !== null) stop();
  render();
}

function frame(now) {
  if (!playing) return;
  const duration = 840 / Number(speed.value);
  const elapsed = now - lastTick;
  if (elapsed >= duration) {
    lastTick = now;
    step();
  } else if (!reducedMotion.matches && history[position].fleets.length) {
    atlas.draw(history[position],selected,elapsed / duration);
  }
  if (playing) animation = requestAnimationFrame(frame);
}

function start() {
  playing = true;
  lastTick = performance.now();
  render();
  animation = requestAnimationFrame(frame);
}

play.addEventListener('click', () => {
  if (playing) {
    stop();
    render();
    return;
  }
  if (history.length === 1) {
    $('config').requestSubmit();
    return;
  }
  if (history[position].winner !== null) position = 0;
  start();
});
$('step').addEventListener('click', () => {
  stop();
  step();
});
timeline.addEventListener('input', () => {
  stop();
  position = Number(timeline.value);
  render();
});
speed.addEventListener('change', () => { lastTick = performance.now(); });

$('config').addEventListener('submit', event => {
  event.preventDefault();
  const config = configFromForm();
  if (!config.seed) {
    seed.setCustomValidity('请输入地图种子');
    seed.reportValidity();
    return;
  }
  setMatch([createMatch(config)]);
  start();
});
$('open-rules').addEventListener('click', () => $('rules').showModal());

function showView(name) {
  view = name;
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.view === name;
    tab.classList.toggle('active',active);
    if (active) tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
    $(tab.dataset.view).hidden = !active;
  }
  if (view === 'series' && playing) {
    stop();
    render();
  }
}
document.querySelector('.tabs').addEventListener('click', event => {
  if (event.target.dataset.view) showView(event.target.dataset.view);
});

function watchGame(config) {
  const frames = [createMatch(config)];
  while (frames.at(-1).winner === null) frames.push(advance(frames.at(-1)));
  showView('arena');
  setMatch(frames);
  window.scrollTo(0,0);
}

function seriesOutput(rows, a, b, total) {
  const overall = rows.reduce((sum,row) => sum.map((value,i) => value + row.wins[i]),[0,0,0]);
  const done = overall.reduce((a,b) => a + b,0);
  const summary = element('div','series-score');
  [1,0,2].forEach((index,i) => {
    const card = element('div','result-card');
    const names = [getName(a),'平局',getName(b)];
    const percentage = done ? (overall[index] / done * 100).toFixed(1) : '0.0';
    card.append(element('span','',names[i]),element('strong','',percentage + '%'),element('span','',overall[index] + ' 局'));
    summary.append(card);
  });
  const scroller = element('div','table-scroll');
  const table = element('table');
  const labels = ['地图',getName(a) + '（A）','平局',getName(b) + '（B）','首局'];
  const headings = table.createTHead().insertRow();
  for (const label of labels) {
    const cell = element('th','',label);
    cell.scope = 'col';
    headings.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const line = body.insertRow();
    for (const label of [MAPS[row.mapId].name,row.wins[1],row.wins[0],row.wins[2]]) line.insertCell().textContent = label;
    const watch = element('button','text-button','回放');
    watch.type = 'button';
    watch.setAttribute('aria-label','回放' + MAPS[row.mapId].name + '的首局');
    watch.disabled = !row.first;
    if (row.first) watch.addEventListener('click', () => watchGame(row.first));
    line.insertCell().append(watch);
  }
  scroller.append(table);
  $('series-output').replaceChildren(summary,element('p','form-note','已完成 ' + done + ' / ' + total + ' 局'),scroller);
}

$('series-form').addEventListener('change', () => {
  $('series-note').textContent = '每组种子在所选地图上各打一轮换边赛。';
});
$('series-form').addEventListener('submit', async event => {
  event.preventDefault();
  const a = $('series-a').value;
  const b = $('series-b').value;
  if (a === b) {
    $('series-note').textContent = '请选择两套不同的策略。';
    return;
  }
  const range = $('series-map').value;
  const maps = range === 'all' ? Object.keys(MAPS) : [range];
  const count = Number($('series-count').value);
  const total = count * maps.length * 2;
  const settings = { ...custom };
  const rows = maps.map(mapId => ({ mapId,wins:[0,0,0],first:null }));
  const button = $('run-series');
  button.disabled = true;
  $('series-progress').textContent = '运行中';
  seriesOutput(rows,a,b,total);
  let completed = 0;
  try {
    for (const row of rows) {
      for (let i = 0; i < count; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        for (const swapped of [false,true]) {
          const config = {
            mapId:row.mapId, seed:String(2407 + i * 137), custom:settings,
            blue:swapped ? b : a, red:swapped ? a : b
          };
          row.first ??= config;
          const { winner } = simulate(config);
          row.wins[winner && swapped ? 3 - winner : winner]++;
          completed++;
        }
        $('series-progress').textContent = completed + ' / ' + total + ' 局';
        seriesOutput(rows,a,b,total);
      }
    }
    $('series-progress').textContent = '测评完成';
  } catch (error) {
    $('series-progress').textContent = '测评失败';
    $('series-note').textContent = '可重新运行本组测评。';
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

setMatch([createMatch(configFromForm())]);
