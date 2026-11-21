import { initChallenge } from './challenge-ui.js';
import { initReplay } from './replay-ui.js';

const replay = initReplay();

function navigate() {
  const showingReplay = window.location.hash === '#replay' && replay.hasMatch();
  document.getElementById('challenge').hidden = showingReplay;
  document.getElementById('replay').hidden = !showingReplay;
  if (showingReplay) replay.render();
  else replay.pause();
  window.scrollTo(0,0);
}

window.addEventListener('hashchange',navigate);
document.getElementById('open-rules').addEventListener('click',() => document.getElementById('rules').showModal());
initChallenge(match => {
  replay.load(match);
  window.location.hash = '#replay';
  navigate();
});
navigate();
