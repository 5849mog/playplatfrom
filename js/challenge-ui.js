import { element } from './dom.js';
import { MAPS } from './engine.js';
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
  for (const match of matches) wins[match.winner]++;
  return wins;
}

function setStatus(id, text, tone = '') {
  const status = $('check-' + id);
  status.textContent = text;
  status.dataset.tone = tone;
}

function renderResults(entrants, matches, openReplay) {
  const cards = element('div','series-score');
  const counts = countWins(matches);
  for (const [index,label] of [
    [1,'A · ' + entrants[0].name], [0,'平局'], [2,'B · ' + entrants[1].name]
  ]) {
    const card = element('div','result-card');
    const ratio = matches.length ? (100 * counts[index] / matches.length).toFixed(1) + '%' : '–';
    card.append(element('span','',label),element('strong','',ratio),element('span','',counts[index] + ' 局'));
    cards.append(card);
  }

  const totals = makeTable(['地图','A 胜','平','B 胜','已完成']);
  for (const mapId of new Set(TRIALS.map(trial => trial.mapId))) {
    const subset = matches.filter(match => match.mapId === mapId);
    const [draws,a,b] = countWins(subset);
    const total = TRIALS.filter(trial => trial.mapId === mapId).length;
    const row = totals.body.insertRow();
    for (const value of [MAPS[mapId].name,a,draws,b,subset.length + ' / ' + total]) row.insertCell().textContent = value;
  }

  const details = element('details','challenge-details');
  details.open = $('challenge-output').querySelector('details')?.open ?? false;
  const rounds = makeTable(['地图','种子','蓝 / 红','回合','胜方','判定','对局']);
  for (const [index,match] of matches.entries()) {
    const row = rounds.body.insertRow();
    const faultText = match.faults.map(({ entrant,detail }) => entrant + ' · ' + detail).join(' / ');
    const labels = [MAPS[match.mapId].name,match.seed,match.swapped ? 'B / A' : 'A / B',
      match.turn,match.winner ? entrantLabel(match.winner - 1) : '平',faultText || match.reason];
    for (const label of labels) row.insertCell().textContent = label;
    const replay = element('button','text-button','回放');
    replay.type = 'button';
    replay.setAttribute('aria-label','回放第 ' + (index + 1) + ' 局');
    replay.addEventListener('click',() => openReplay(match.frames));
    row.insertCell().append(replay);
  }
  const faultCount = matches.filter(match => match.faults.length).length;
  const countText = '已完成 ' + matches.length + ' / ' + TRIALS.length + ' 局 · ' + faultCount + ' 局含代码判罚';
  details.append(element('summary','','逐局记录与回放'),rounds.wrapper);
  const nodes = [cards,element('p','form-note challenge-footnote',countText),totals.wrapper];
  if (matches.length) nodes.push(details);
  $('challenge-output').replaceChildren(...nodes);
}

function saveReport(report) {
  const blob = new Blob([JSON.stringify(report,null,2)],{ type:'application/json' });
  const address = URL.createObjectURL(blob);
  const link = element('a');
  link.href = address;
  link.download = 'siege-grid-' + SUITE.replace('/','-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(address),1000);
}

export function initChallenge(openReplay) {
  const prompt = $('challenge-prompt');
  prompt.value = CHALLENGE_PROMPT;
  $('suite-tags').append(...[PROTOCOL,SUITE,TRIALS.length + ' 局 · 双向换边',BUDGET_MS + ' ms / 回合'].map(label => element('span','',label)));

  $('copy-prompt').addEventListener('click',async () => {
    try {
      await navigator.clipboard.writeText(CHALLENGE_PROMPT);
      $('copy-status').textContent = '已复制完整提示词';
    } catch {
      prompt.closest('details').open = true;
      prompt.select();
      $('copy-status').textContent = '提示词已选中，可以手动复制';
    }
  });

  const run = $('run-challenge');
  const validate = $('validate-challenge');
  const cancel = $('cancel-challenge');
  const feedback = $('challenge-feedback');
  const download = $('export-challenge');
  let controller;
  let completedReport;

  for (const [index,id] of SLOT_IDS.entries()) {
    const code = $('code-' + id);
    code.addEventListener('input',() => setStatus(id,code.value.trim() ? '待校验' : '等待代码'));
    $('sample-' + id).addEventListener('click',() => {
      code.value = index === 0 ? SAMPLE : DEFENSIVE_SAMPLE;
      setStatus(id,'已填入示例 · 待校验');
    });
  }

  cancel.addEventListener('click',() => controller?.abort());
  download.addEventListener('click',() => {
    if (completedReport) saveReport(completedReport);
  });

  function busy(value) {
    run.disabled = validate.disabled = value;
    cancel.hidden = !value;
    for (const id of SLOT_IDS) {
      $('code-' + id).readOnly = $('name-' + id).readOnly = value;
      $('sample-' + id).disabled = value;
    }
  }

  $('challenge-form').addEventListener('submit',async event => {
    event.preventDefault();
    if (controller) return;
    const onlyValidate = event.submitter === validate;
    const entrants = SLOT_IDS.map((id,index) => {
      try {
        return { name:$('name-' + id).value.trim() || '策略 ' + entrantLabel(index), source:normalizeSource($('code-' + id).value) };
      } catch (error) {
        setStatus(id,error.message,'error');
        return null;
      }
    });
    if (entrants.includes(null)) {
      feedback.textContent = '请检查参赛代码。';
      return;
    }
    controller = new AbortController();
    const { signal } = controller;
    busy(true);
    feedback.textContent = '正在校验两套代码…';
    const matches = [];
    try {
      const checked = await Promise.all(entrants.map(async ({ source },index) => {
        const id = SLOT_IDS[index];
        setStatus(id,'校验中…');
        const result = await checkSubmission(source,signal);
        if (result.fault) setStatus(id,result.fault,'error');
        else setStatus(id,'通过 ' + result.checks + ' 个校验场景','ok');
        return !result.fault;
      }));
      if (!checked.every(Boolean)) {
        feedback.textContent = '有代码未通过校验。修正标出的错误后可重试。';
        return;
      }
      if (onlyValidate) {
        feedback.textContent = '两套代码均通过校验，可以开始正式测评。';
        return;
      }
      completedReport = null;
      download.hidden = true;
      feedback.textContent = '正在进行第 1 / ' + TRIALS.length + ' 局…';
      renderResults(entrants,matches,openReplay);
      for (const [index,trial] of TRIALS.entries()) {
        signal.throwIfAborted();
        feedback.textContent = '正在进行第 ' + (index + 1) + ' / ' + TRIALS.length + ' 局…';
        matches.push(await challengeMatch(trial,entrants,{ signal,record:true }));
        renderResults(entrants,matches,openReplay);
      }
      completedReport = {
        protocol:PROTOCOL, rules:RULESET, suite:SUITE, decisionBudgetMs:BUDGET_MS,
        teams:await Promise.all(entrants.map(async ({ name,source },index) => ({
          entrant:entrantLabel(index), name, sourceSha256:await fingerprint(source)
        }))),
        matches:matches.map(({ frames, scores, ...match }) => ({
          ...match, winner:match.winner ? entrantLabel(match.winner - 1) : 'draw', scoresBlueRed:scores
        }))
      };
      download.hidden = false;
      feedback.textContent = '测评完成 · ' + matches.length + ' 局';
    } catch (error) {
      if (signal.aborted) {
        feedback.textContent = '已停止 · 保留本次已完成的 ' + matches.length + ' 局';
      } else {
        feedback.textContent = '评测中断 · ' + error.message;
      }
      for (const id of SLOT_IDS) {
        if ($('check-' + id).textContent === '校验中…') setStatus(id,'校验中断');
      }
    } finally {
      controller.abort();
      controller = null;
      busy(false);
    }
  });
}
