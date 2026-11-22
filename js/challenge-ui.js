import { element } from './dom.js';
import { readDraft, writeDraft } from './workbench-draft.js';
import { MAPS, getStats } from './engine.js';
import {
  BUDGET_MS, CHALLENGE_PROMPT, DEFENSIVE_SAMPLE, PROTOCOL, RULESET, SAMPLE, SUITE, TRIALS,
  challengeMatch, checkSubmission, fingerprint, normalizeSource
} from './challenge.js';

const $ = id => document.getElementById(id);
const SLOT_IDS = ['a','b'];
const entrantLabel = index => SLOT_IDS[index].toUpperCase();

function makeTable(headings) {
  const wrapper = element('div','table-scroll');
  const table = element('table');
  const row = table.createTHead().insertRow();
  for (const heading of headings) {
    const cell = element('th','',heading);
    cell.scope = 'col';
    row.append(cell);
  }
  wrapper.append(table);
  return { wrapper,body:table.createTBody() };
}

function countWins(matches) {
  const wins = [0,0,0];
  for (const match of matches) {
    if (match.winner !== null) wins[match.winner]++;
  }
  return wins;
}

function setStatus(id, text, tone = '') {
  const status = $('check-' + id);
  status.textContent = text;
  status.dataset.tone = tone;
  $('slot-status-' + id).textContent = tone === 'ok' ? '已通过' : tone === 'error' ? '需检查'
    : $('code-' + id).value.trim() ? '已填代码' : '待粘贴';
}

function replayButton(match, index, openReplay, primary = false) {
  const button = element('button',primary ? 'button primary' : 'text-button','打开回放');
  button.type = 'button';
  button.setAttribute('aria-label','打开第 ' + (index + 1) + ' 局回放');
  button.addEventListener('click',() => openReplay(match,button));
  return button;
}

function explainMatch(match) {
  return match.faults.map(({ entrant,detail }) => entrant + ' · ' + detail).join(' / ') || match.reason;
}

function renderSingle(entrants, match, openReplay) {
  const output = $('challenge-output');
  if (!match) {
    output.replaceChildren(element('p','empty','单局进行中'));
    return;
  }
  const heading = match.winner === null ? '未完赛' : match.winner
    ? entrantLabel(match.winner - 1) + ' · ' + entrants[match.winner - 1].name + ' 获胜' : '平局';
  const summary = [MAPS[match.mapId].name,'种子 ' + match.seed,match.swapped ? 'B 蓝方 / A 红方' : 'A 蓝方 / B 红方','第 ' + match.turn + ' 回合'].join(' · ');
  const info = element('div');
  info.append(element('h3','',heading),element('p','form-note',summary),element('p','form-note',explainMatch(match)));
  const card = element('div','single-result');
  card.append(info,replayButton(match,0,openReplay,true));
  output.replaceChildren(card);
}

function renderResults(entrants, matches, trials, benchmark, openReplay) {
  if (!benchmark) {
    renderSingle(entrants,matches[0],openReplay);
    return;
  }
  const [draws,a,b] = countWins(matches);
  const judged = draws + a + b;
  const cards = element('div','series-score');
  for (const [wins,label] of [[a,'A · ' + entrants[0].name],[draws,'平局'],[b,'B · ' + entrants[1].name]]) {
    const card = element('div','result-card');
    const ratio = judged ? (100 * wins / judged).toFixed(1) + '%' : '–';
    card.append(element('span','',label),element('strong','',ratio),element('span','',wins + ' 局'));
    cards.append(card);
  }

  const rounds = makeTable(['对局','地图','种子','蓝 / 红','回合','结果','判定']);
  for (const [index,match] of matches.entries()) {
    const row = rounds.body.insertRow();
    const winner = match.winner === null ? '未完赛' : match.winner ? entrantLabel(match.winner - 1) + ' 胜' : '平局';
    row.insertCell().append(replayButton(match,index,openReplay));
    const labels = [MAPS[match.mapId].name,match.seed,match.swapped ? 'B / A' : 'A / B',
      match.turn,winner,explainMatch(match)];
    for (const label of labels) row.insertCell().textContent = label;
  }
  const faultCount = matches.filter(match => match.faults.length).length;
  const countText = '已处理 ' + matches.length + ' / ' + trials.length + ' 局 · ' + judged +
    ' 局完赛 · ' + (matches.length - judged) + ' 局未完赛 · ' + faultCount + ' 局含代码判罚';
  const info = element('p','form-note challenge-footnote',countText);
  const perMap = makeTable(['地图','A 胜','平','B 胜','未完赛','已处理']);
  for (const mapId of new Set(trials.map(trial => trial.mapId))) {
    const subset = matches.filter(match => match.mapId === mapId);
    const [tied,first,second] = countWins(subset);
    const total = trials.filter(trial => trial.mapId === mapId).length;
    const row = perMap.body.insertRow();
    for (const value of [MAPS[mapId].name,first,tied,second,subset.length - first - second - tied,subset.length + ' / ' + total]) {
      row.insertCell().textContent = value;
    }
  }
  const details = element('details','challenge-details');
  details.open = $('challenge-output').querySelector('details')?.open ?? false;
  details.append(element('summary','','逐局记录与回放'),rounds.wrapper);
  const nodes = [cards,info,perMap.wrapper];
  if (matches.length) nodes.push(details);
  $('challenge-output').replaceChildren(...nodes);
}

function saveReport(report) {
  const blob = new Blob([JSON.stringify(report,null,2)],{ type:'application/json' });
  const address = URL.createObjectURL(blob);
  const link = element('a');
  link.href = address;
  link.download = 'siege-grid-' + report.mode + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(address),1000);
}

export function initChallenge(openReplay) {
  const prompt = $('challenge-prompt');
  const form = $('challenge-form');
  const run = $('run-challenge');
  const validate = $('validate-challenge');
  const cancel = $('cancel-challenge');
  const stopMatch = $('stop-match');
  const feedback = $('challenge-feedback');
  const download = $('export-challenge');
  const singleMap = $('single-map');
  const singleSeed = $('single-seed');
  const singleSides = $('single-sides');
  const modes = [...form.querySelectorAll('input[name="mode"]')];
  let controller;
  let matchController;
  let completedReport;
  const verified = new Map();

  const jumpResults = $('jump-results');
  const draft = readDraft();
  prompt.value = CHALLENGE_PROMPT;
  $('suite-meta').textContent = [PROTOCOL,SUITE,BUDGET_MS + ' ms / 回合'].join(' · ');
  for (const [id,map] of Object.entries(MAPS)) singleMap.append(new Option(map.name,id));
  if (Object.hasOwn(MAPS,draft?.map)) singleMap.value = draft.map;
  if (typeof draft?.seed === 'string') singleSeed.value = draft.seed;
  if (draft?.sides === 'swapped') singleSides.value = draft.sides;
  if (draft?.mode === 'benchmark') modes[1].checked = true;

  const isBenchmark = () => modes[1].checked;
  function showMode() {
    const benchmark = isBenchmark();
    $('single-settings').hidden = benchmark;
    $('benchmark-settings').hidden = !benchmark;
    run.textContent = benchmark ? '开始标准测评' : '开始单局';
  }

  function saveDraft() {
    const saved = writeDraft({
      map:singleMap.value, seed:singleSeed.value, sides:singleSides.value,
      mode:isBenchmark() ? 'benchmark' : 'single',
      slots:Object.fromEntries(SLOT_IDS.map(id => [id,{
        name:$('name-' + id).value, source:$('code-' + id).value
      }]))
    });
    $('draft-status').textContent = saved ? '代码和配置已保存在此浏览器' : '此浏览器未能保存草稿';
  }

  for (const mode of modes) {
    mode.addEventListener('change',() => {
      showMode();
      saveDraft();
    });
  }
  showMode();
  singleMap.addEventListener('change',saveDraft);
  singleSeed.addEventListener('input',saveDraft);
  singleSides.addEventListener('change',saveDraft);
  $('roll-seed').addEventListener('click',() => {
    singleSeed.value = String(Math.floor(Math.random() * 90000) + 10000);
    saveDraft();
  });

  function selectSlot(id, focusCode = false) {
    form.dataset.activeSlot = id;
    for (const slot of SLOT_IDS) $('slot-' + slot).setAttribute('aria-pressed',String(slot === id));
    if (focusCode) $('code-' + id).focus();
  }

  jumpResults.addEventListener('click',() => {
    const title = $('challenge-results-title');
    title.closest('section').scrollIntoView({ block:'start' });
    title.focus({ preventScroll:true });
  });

  $('copy-prompt').addEventListener('click',async () => {
    try {
      await navigator.clipboard.writeText(CHALLENGE_PROMPT);
      $('copy-status').textContent = '已复制完整提示词';
    } catch {
      prompt.closest('details').open = true;
      prompt.focus();
      prompt.select();
      $('copy-status').textContent = '提示词已选中，可以手动复制';
    }
  });

  for (const [index,id] of SLOT_IDS.entries()) {
    const code = $('code-' + id);
    const name = $('name-' + id);
    const saved = draft?.slots?.[id];
    if (typeof saved?.name === 'string') name.value = saved.name;
    if (typeof saved?.source === 'string') code.value = saved.source;
    if (code.value.trim()) setStatus(id,'已恢复草稿 · 待校验');

    name.addEventListener('input',saveDraft);
    $('slot-' + id).addEventListener('click',() => selectSlot(id));
    code.addEventListener('input',() => {
      setStatus(id,code.value.trim() ? '待校验' : '等待代码');
      saveDraft();
    });

    function put(source, status) {
      code.value = source;
      setStatus(id,status);
      saveDraft();
    }

    $('sample-' + id).addEventListener('click',() => {
      put(index === 0 ? SAMPLE : DEFENSIVE_SAMPLE,'已填入示例 · 待校验');
    });
    $('paste-' + id).addEventListener('click',async () => {
      const previous = code.value;
      try {
        const source = await navigator.clipboard.readText();
        if (controller || code.value !== previous) return;
        if (source.trim()) put(source,'已粘贴 · 待校验');
        else setStatus(id,'剪贴板中没有可粘贴的文本');
      } catch {
        if (controller) return;
        setStatus(id,'可在输入框内使用系统粘贴');
        selectSlot(id,true);
      }
    });
  }

  cancel.addEventListener('click',() => controller?.abort());
  stopMatch.addEventListener('click',() => {
    stopMatch.disabled = true;
    matchController?.abort();
  });
  download.addEventListener('click',() => {
    if (completedReport) saveReport(completedReport);
  });

  function busy(value) {
    for (const control of [run,validate,singleMap,singleSides,$('roll-seed'),...modes]) control.disabled = value;
    singleSeed.readOnly = value;
    run.hidden = validate.hidden = value;
    for (const id of SLOT_IDS) {
      $('code-' + id).readOnly = $('name-' + id).readOnly = value;
      $('sample-' + id).disabled = $('paste-' + id).disabled = value;
    }
  }

  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (controller) return;
    const onlyValidate = event.submitter === validate;
    const benchmark = isBenchmark();
    const entrants = SLOT_IDS.map((id,index) => {
      try {
        return { name:$('name-' + id).value.trim() || '策略 ' + entrantLabel(index), source:normalizeSource($('code-' + id).value) };
      } catch (error) {
        setStatus(id,error.message,'error');
        return null;
      }
    });
    if (entrants.includes(null)) {
      const missing = entrants.indexOf(null);
      feedback.textContent = '请检查算法 ' + entrantLabel(missing) + ' 的代码。';
      selectSlot(SLOT_IDS[missing],true);
      return;
    }
    const trials = benchmark ? TRIALS
      : [{ mapId:singleMap.value, seed:singleSeed.value.trim(), swapped:singleSides.value === 'swapped' }];
    if (!onlyValidate && !trials[0].seed) {
      feedback.textContent = '请输入地图种子。';
      singleSeed.focus();
      return;
    }
    controller = new AbortController();
    const { signal } = controller;
    busy(true);
    feedback.textContent = '正在校验两套代码…';
    cancel.textContent = '停止校验';
    cancel.hidden = false;
    const matches = [];
    let invalidSlot;
    try {
      const checked = await Promise.all(entrants.map(async ({ source },index) => {
        const id = SLOT_IDS[index];
        const cached = verified.get(id);
        if (cached?.source === source) {
          setStatus(id,'通过 ' + cached.checks + ' 个校验场景','ok');
          return true;
        }
        setStatus(id,'校验中…');
        const result = await checkSubmission(source,signal);
        if (result.fault) {
          setStatus(id,result.fault,'error');
          return false;
        }
        verified.set(id,{ source,checks:result.checks });
        setStatus(id,'通过 ' + result.checks + ' 个校验场景','ok');
        return true;
      }));
      if (!checked.every(Boolean)) {
        const failed = checked.indexOf(false);
        invalidSlot = SLOT_IDS[failed];
        feedback.textContent = '算法 ' + entrantLabel(failed) + ' 未通过校验。';
        return;
      }
      if (onlyValidate) {
        feedback.textContent = '两套代码均通过校验，可以开赛。';
        return;
      }
      completedReport = null;
      download.hidden = jumpResults.hidden = true;
      cancel.textContent = '停止整组测评';
      cancel.hidden = !benchmark;
      renderResults(entrants,matches,trials,benchmark,openReplay);
      $('live-match').hidden = false;

      for (const [index,trial] of trials.entries()) {
        if (signal.aborted) break;
        const current = new AbortController();
        matchController = current;
        const matchSignal = AbortSignal.any([signal,current.signal]);
        stopMatch.textContent = benchmark ? '跳过本局' : '中止本局';
        stopMatch.disabled = false;
        stopMatch.hidden = false;
        const label = (benchmark ? '第 ' + (index + 1) + ' / ' + trials.length + ' 局 · ' : '') + MAPS[trial.mapId].name;
        feedback.textContent = label + ' · 种子 ' + trial.seed;
        let updated = -Infinity;
        const match = await challengeMatch(trial,entrants,{
          signal:matchSignal,
          onTurn(state,names) {
            const now = performance.now();
            if (now - updated < 120 && state.winner === null) return;
            updated = now;
            const [,blue,red] = getStats(state);
            $('live-round').textContent = '第 ' + state.turn + ' 回合';
            $('live-summary').textContent = names[0] + '（蓝）对 ' + names[1] +
              '（红） · 据点 ' + blue.land + ' 比 ' + red.land + ' · 兵力 ' + blue.units + ' 比 ' + red.units;
          }
        });
        matches.push(match);
        jumpResults.hidden = false;
        renderResults(entrants,matches,trials,benchmark,openReplay);
      }

      if (matches.length) {
        completedReport = {
          protocol:PROTOCOL, rules:RULESET, suite:benchmark ? SUITE : null,
          mode:benchmark ? 'benchmark' : 'single', decisionBudgetMs:BUDGET_MS,
          plannedMatches:trials.length,
          teams:await Promise.all(entrants.map(async ({ name,source },index) => ({
            entrant:entrantLabel(index), name, sourceSha256:await fingerprint(source)
          }))),
          matches:matches.map(({ recording,names,...match }) => ({
            ...match, winner:match.winner === null ? null : match.winner ? entrantLabel(match.winner - 1) : 'draw'
          }))
        };
        download.hidden = false;
      }
      const count = matches.filter(match => match.winner !== null).length;
      if (!benchmark) feedback.textContent = count ? '单局已完赛，可以回放。' : '单局已中止，记录为未完赛。';
      else feedback.textContent = (signal.aborted ? '已停止测评' : '测评结束') + ' · ' + count + ' / ' + trials.length + ' 局完赛';
    } catch (error) {
      feedback.textContent = signal.aborted ? '已停止校验。' : '评测中断 · ' + error.message;
      for (const id of SLOT_IDS) {
        if ($('check-' + id).textContent === '校验中…') setStatus(id,'校验中断');
      }
    } finally {
      controller.abort();
      controller = null;
      matchController = null;
      busy(false);
      if (invalidSlot) selectSlot(invalidSlot,true);
      cancel.hidden = stopMatch.hidden = $('live-match').hidden = true;
    }
  });
}
