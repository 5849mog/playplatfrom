const DRAFT_KEY = 'siege-grid.playplatfrom.workbench.v1';

export function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

export function writeDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY,JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
