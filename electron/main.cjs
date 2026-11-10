const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SERVICES = [
  { id: 'chatgpt', url: 'https://chatgpt.com/' },
  { id: 'gemini', url: 'https://gemini.google.com/app' },
  { id: 'claude', url: 'https://claude.ai/new' },
];
const views = new Map();
let mainWindow;
let debateCancelled = false;

const editorSelectors = {
  chatgpt: ['#prompt-textarea', 'div[contenteditable="true"]'],
  gemini: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'],
  claude: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
};
const answerSelectors = {
  chatgpt: ['[data-message-author-role="assistant"]'],
  gemini: ['model-response .model-response-text', 'model-response', '.response-container-content', '[data-test-id="model-response"]'],
  claude: ['[data-testid="assistant-message"]', '.font-claude-response-body', '[data-is-streaming] .prose', 'div.prose'],
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createAiViews(win) {
  for (const service of SERVICES) {
    const partition = `persist:dascan-${service.id}`;
    const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, sandbox: true } });
    views.set(service.id, view);
    win.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36');
    view.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 620, height: 820, parent: win, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition, contextIsolation: true, sandbox: true } } }));
    view.webContents.on('did-finish-load', () => win.webContents.send('ai-ready', service.id));
    view.webContents.loadURL(service.url);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1500, height: 940, minWidth: 980, minHeight: 680, title: '다스캔', backgroundColor: '#f3f5f8', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  mainWindow.removeMenu();
  if (process.argv.includes('--dev')) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  createAiViews(mainWindow);
  mainWindow.on('closed', () => { views.clear(); mainWindow = null; });
}

async function sendPrompt(id, text) {
  const view = views.get(id);
  if (!view) return { ok: false, error: '서비스를 찾지 못했습니다.' };
  try {
    const focused = await view.webContents.executeJavaScript(`(() => { const selectors=${JSON.stringify(editorSelectors[id] || [])}; const visible=e=>e&&e.offsetParent!==null&&!e.disabled; let el; for(const selector of selectors){el=[...document.querySelectorAll(selector)].find(visible);if(el)break} if(!el)return false; el.focus(); if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){el.select()}else{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)} return true })()`, true);
    if (!focused) return { ok: false, error: '입력창을 찾지 못했습니다. 로그인을 확인하세요.' };
    view.webContents.insertText(text);
    await wait(300);
    const clicked = await view.webContents.executeJavaScript(`(() => { const visible=e=>e&&e.offsetParent!==null&&!e.disabled; const selectors=['button[data-testid="send-button"]','button[aria-label*="Send"]','button[aria-label*="send"]','button[aria-label*="보내기"]','button[aria-label*="전송"]','button[type="submit"]']; for(const selector of selectors){const button=[...document.querySelectorAll(selector)].find(visible);if(button){button.click();return true}} return false })()`, true);
    if (!clicked) {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
    }
    return { ok: true, sent: true, method: clicked ? 'button' : 'enter' };
  } catch (error) { return { ok: false, error: error.message }; }
}

async function latestAnswer(id) {
  const view = views.get(id);
  if (!view) return '';
  return view.webContents.executeJavaScript(`(() => { const selectors=${JSON.stringify(answerSelectors[id] || [])}; const visible=e=>e&&e.offsetParent!==null; for(const selector of selectors){const items=[...document.querySelectorAll(selector)].filter(visible).map(e=>(e.innerText||e.textContent||'').trim()).filter(t=>t.length>10);if(items.length)return items.at(-1)} return '' })()`, true);
}

async function waitForAnswer(id, before = '', timeoutMs = 120000) {
  const started = Date.now();
  let last = ''; let stable = 0;
  while (Date.now() - started < timeoutMs) {
    if (debateCancelled) throw new Error('토론이 중지되었습니다.');
    await wait(2000);
    const current = await latestAnswer(id);
    if (current && current !== before && current.length > 20) {
      if (current === last) stable += 1; else stable = 0;
      last = current;
      if (stable >= 2) return current;
    }
  }
  throw new Error(`${id}의 답변 대기 시간이 초과되었습니다.`);
}

function progress(payload) { mainWindow?.webContents.send('debate-progress', payload); }

async function runDebate(topic, maxRounds) {
  debateCancelled = false;
  const history = [];
  progress({ state: 'running', round: 1, message: '1라운드: 찬성·반대의 첫 주장을 요청합니다.' });
  const beforePro = await latestAnswer('chatgpt');
  const beforeCon = await latestAnswer('gemini');
  const [sentPro, sentCon] = await Promise.all([
    sendPrompt('chatgpt', `당신은 실제 토론의 찬성 측 토론자입니다. 주제: “${topic}”\n명확한 입장을 밝히고 근거·사례·예상되는 반론을 포함해 500자 안팎의 첫 주장을 하세요. 상대를 존중하되 논리적으로 설득하세요.`),
    sendPrompt('gemini', `당신은 실제 토론의 반대 측 토론자입니다. 주제: “${topic}”\n명확한 입장을 밝히고 근거·사례·예상되는 반론을 포함해 500자 안팎의 첫 주장을 하세요. 상대를 존중하되 논리적으로 설득하세요.`),
  ]);
  if (!sentPro.ok || !sentCon.ok) throw new Error(`토론자 입력 실패: ${sentPro.error || sentCon.error}`);
  const [proFirst, conFirst] = await Promise.all([waitForAnswer('chatgpt', beforePro), waitForAnswer('gemini', beforeCon)]);
  history.push({ round: 1, pro: proFirst, con: conFirst });

  for (let round = 1; round <= maxRounds; round += 1) {
    progress({ state: 'running', round, message: `${round}라운드: 사회자가 양측 주장을 판정합니다.` });
    const current = history.at(-1);
    const beforeMod = await latestAnswer('claude');
    const forceConclusion = round === maxRounds;
    const moderatorPrompt = `당신은 실제 공개토론의 공정한 사회자입니다.\n주제: “${topic}”\n현재 ${round}라운드 찬성 발언:\n${current.pro}\n\n현재 ${round}라운드 반대 발언:\n${current.con}\n\n양측의 핵심 근거, 직접 충돌하는 쟁점, 논리적 강점과 약점을 구체적으로 평가하세요. ${forceConclusion ? '최대 라운드이므로 반드시 최종 결론을 내려야 합니다.' : '결론을 내릴 만큼 논거가 충분하거나 합의점이 생겼다면 최종 결론을 내리고, 아직 핵심 쟁점이 남았다면 다음 라운드 질문을 제시하세요.'}\n결론을 내리면 맨 첫 줄에 [토론 종료]를, 계속하면 [토론 계속]을 쓰세요. 종료 시에는 승패보다 조건부 결론, 남은 불확실성, 실제 사람이 취할 합리적인 선택을 포함하세요.`;
    const sentMod = await sendPrompt('claude', moderatorPrompt);
    if (!sentMod.ok) throw new Error(`사회자 입력 실패: ${sentMod.error}`);
    const moderator = await waitForAnswer('claude', beforeMod);
    current.moderator = moderator;
    if (/\[토론\s*종료\]/.test(moderator) || forceConclusion) {
      progress({ state: 'complete', round, message: `${round}라운드에서 사회자가 최종 결론을 내렸습니다.`, history });
      return { ok: true, rounds: round, history };
    }

    progress({ state: 'running', round: round + 1, message: `${round + 1}라운드: 양측이 상대 주장과 사회자 질문에 재반박합니다.` });
    const beforeNextPro = await latestAnswer('chatgpt');
    const beforeNextCon = await latestAnswer('gemini');
    const [nextProSent, nextConSent] = await Promise.all([
      sendPrompt('chatgpt', `토론 주제: “${topic}”\n상대(반대 측)의 직전 발언:\n${current.con}\n\n사회자의 평가와 질문:\n${moderator}\n\n실제 토론자처럼 상대의 가장 강한 근거를 먼저 정확히 요약한 뒤 반박하세요. 자신의 약점도 하나 인정하고 보완 논거를 제시하세요. 새로운 근거를 포함해 500자 안팎으로 답하세요.`),
      sendPrompt('gemini', `토론 주제: “${topic}”\n상대(찬성 측)의 직전 발언:\n${current.pro}\n\n사회자의 평가와 질문:\n${moderator}\n\n실제 토론자처럼 상대의 가장 강한 근거를 먼저 정확히 요약한 뒤 반박하세요. 자신의 약점도 하나 인정하고 보완 논거를 제시하세요. 새로운 근거를 포함해 500자 안팎으로 답하세요.`),
    ]);
    if (!nextProSent.ok || !nextConSent.ok) throw new Error(`재반박 입력 실패: ${nextProSent.error || nextConSent.error}`);
    const [nextPro, nextCon] = await Promise.all([waitForAnswer('chatgpt', beforeNextPro), waitForAnswer('gemini', beforeNextCon)]);
    history.push({ round: round + 1, pro: nextPro, con: nextCon });
  }
  return { ok: true, rounds: maxRounds, history };
}

ipcMain.on('layout-views', (_event, layouts) => { for (const [id, view] of views) { const item = layouts.find(x => x.id === id); if (!item) { view.setVisible(false); continue; } view.setBounds({ x: Math.round(item.x), y: Math.round(item.y), width: Math.max(1, Math.round(item.width)), height: Math.max(1, Math.round(item.height)) }); view.setVisible(true); } });
ipcMain.handle('send-prompt', (_event, { id, text }) => sendPrompt(id, text));
ipcMain.handle('start-debate', async (_event, { topic, maxRounds }) => { try { return await runDebate(topic, Math.min(5, Math.max(2, Number(maxRounds) || 3))); } catch (error) { progress({ state: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.on('cancel-debate', () => { debateCancelled = true; });
ipcMain.on('reload-ai', (_event, id) => views.get(id)?.webContents.reload());
ipcMain.handle('request-uninstall', async () => {
  const candidates = [
    path.join(path.dirname(process.execPath), 'Uninstall 다스캔.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dascan', 'Uninstall 다스캔.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'dascan', 'Uninstall 다스캔.exe'),
  ];
  const uninstaller = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!uninstaller) return { ok: false, error: '제거 프로그램을 찾지 못했습니다. 새 설치 파일로 다시 설치한 뒤 제거해 주세요.' };
  const result = await dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['취소', '프로그램 제거'], defaultId: 0, cancelId: 0, title: '다스캔 제거', message: '다스캔을 이 컴퓨터에서 제거할까요?', detail: 'AI 서비스 로그인 정보는 별도의 사용자 데이터 폴더에 남을 수 있습니다.' });
  if (result.response !== 1) return { ok: false, cancelled: true };
  spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 500);
  return { ok: true };
});

app.whenReady().then(() => { session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(permission))); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
