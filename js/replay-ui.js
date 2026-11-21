import { WIDTH, HEIGHT, MAPS, TEAMS, getStats } from './engine.js';
import { Atlas } from './atlas.js';
import { element } from './dom.js';

const $ = id => document.getElementById(id);
const KINDS = { base:'要塞', city:'城市', town:'城镇', post:'前哨' };

export function initReplay() {
  const atlas = new Atlas($('atlas'));
  const timeline = $('timeline');
  const play = $('play');
  const step = $('step');
  const speed = $('speed');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
  let match;
  let position = 0;
  let selected = null;
  let playing = false;
  let lastTick = 0;
  let animation = 0;
  let markers = [];

  function load(run) {
    pause();
    match = run;
    position = 0;
    selected = null;
    const first = match.recording.at(0);
    const map = MAPS[match.mapId];
    const winner = match.winner === null ? '未完赛' : match.winner ? '策略 ' + (match.winner === 1 ? 'A' : 'B') + ' 获胜' : '平局';
    $('battle-name').textContent = map.name;
    $('battle-subtitle').textContent = '种子 ' + match.seed + ' · ' + map.subtitle;
    $('replay-summary').textContent = winner + ' · ' + match.reason;
    for (const [id,name] of [['blue-name',match.names[0]],['red-name',match.names[1]]]) {
      $(id).textContent = name;
      $(id).title = name;
    }
    markers = first.nodes.map(node => {
      const button = element('button','node');
      const number = element('span','node-marker');
      button.type = 'button';
      button.dataset.kind = node.kind;
      button.dataset.label = node.y < 165 ? 'up' : 'down';
      button.style.left = node.x / WIDTH * 100 + '%';
      button.style.top = node.y / HEIGHT * 100 + '%';
      button.append(number,element('span','node-name',node.name));
      button.addEventListener('click',() => {
        selected = selected === node.id ? null : node.id;
        render();
      });
      return { button,number };
    });
    $('nodes').replaceChildren(...markers.map(marker => marker.button));
  }

  function renderSites(state) {
    for (const node of state.nodes) {
      const { button,number } = markers[node.id];
      const active = node.id === selected;
      button.dataset.owner = node.owner;
      button.classList.toggle('selected',active);
      button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label',node.name + '，' + (TEAMS[node.owner] ?? '中立') + '，驻军 ' + node.units);
      number.textContent = node.units;
    }
    const node = state.nodes[selected];
    $('site-detail').textContent = node
      ? [node.name,KINDS[node.kind],TEAMS[node.owner] ?? '中立','驻军 ' + node.units,'产能 +' + node.rate].join(' · ')
      : '点击据点查看驻军';
  }

  function renderEvents(state) {
    const rows = [];
    // A fixed display window keeps seek responsive, including long periods without a move.
    for (let turn = Math.max(1,position - 15); turn <= position; turn++) {
      for (const event of match.recording.at(turn).events) {
        const side = TEAMS[event.team] ?? '守军';
        const target = state.nodes[event.to].name;
        let label = side + '占领' + target;
        if (event.type === 'hold') label = side + '守住' + target;
        if (event.type === 'move') label = side + '从' + state.nodes[event.from].name + '派出 ' + event.units + ' 兵力前往' + target;
        const row = element('li');
        row.dataset.team = event.team;
        row.append(element('time','',turn),element('i'),element('span','',label));
        rows.push(row);
      }
    }
    $('events-list').replaceChildren(...(rows.length ? rows.reverse().slice(0,20)
      : [element('li','empty','近期回合没有出兵或据点易主。')]));
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
  }

  function render() {
    if (!match) return;
    const state = match.recording.at(position);
    const total = match.recording.lastTurn;
    $('turn').textContent = '第 ' + position + ' / ' + total + ' 回合';
    play.textContent = playing ? '暂停' : position === total && total ? '重播' : '播放';
    play.disabled = total === 0;
    step.disabled = position === total;
    timeline.max = total;
    timeline.value = position;
    timeline.disabled = total === 0;
    timeline.setAttribute('aria-valuetext','第 ' + position + ' 回合，共 ' + total + ' 个已记录回合');
    renderSites(state);
    renderMeters(state);
    renderEvents(state);
    atlas.draw(state,selected,0);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(animation);
  }

  function next() {
    position++;
    if (position === match.recording.lastTurn) pause();
    render();
  }

  function frame(now) {
    if (!playing) return;
    const duration = 840 / Number(speed.value);
    const elapsed = now - lastTick;
    if (elapsed >= duration) {
      lastTick = now;
      next();
    } else if (!reducedMotion.matches) {
      const state = match.recording.at(position);
      if (state.fleets.length) atlas.draw(state,selected,elapsed / duration);
    }
    if (playing) animation = requestAnimationFrame(frame);
  }

  play.addEventListener('click',() => {
    if (playing) pause();
    else {
      if (position === match.recording.lastTurn) position = 0;
      playing = true;
      lastTick = performance.now();
      animation = requestAnimationFrame(frame);
    }
    render();
  });
  step.addEventListener('click',() => {
    pause();
    next();
  });
  timeline.addEventListener('input',() => {
    pause();
    position = Number(timeline.value);
    render();
  });
  speed.addEventListener('change',() => { lastTick = performance.now(); });
  return { load,render,pause,hasMatch:() => !!match };
}
