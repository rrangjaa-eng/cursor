#!/usr/bin/env node
// 화면 파일을 고치기 전에 디자인 지침(design-guide, 프로젝트에 있으면 design-gate)을 읽게 한다.
//   record — PostToolUse(Skill)·UserPromptSubmit: 지침 스킬을 부르면 세션 표시를 남긴다
//   check  — PreToolUse(Edit|Write|MultiEdit): 표시 없이 화면 파일을 고치면 exit 2로 막는다
// 입력을 못 읽으면 막지 않는다(지침 알림용 관문이라 세션을 멈추지 않는다).
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.DESIGN_GUIDE_STATE_DIR
  || path.join(os.homedir(), '.claude', 'state', 'design-guide');
const GUIDE_SKILLS = ['design-guide', 'design-gate'];
const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/i;
const TEST_FILE = /\.(test|spec)\.[^./\\]+$/i;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isGuide = (name) => GUIDE_SKILLS.includes(String(name).split(':').pop());
const marker = (sessionId) => path.join(STATE_DIR, String(sessionId).replace(/[^\w.-]/g, '_'));

function record(input) {
  const prompted = /^\/(\S+)/.exec(input.prompt || '');
  const name = input.tool_input?.skill ?? prompted?.[1];
  if (!input.session_id || !name || !isGuide(name)) return;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const now = Date.now();
  for (const f of fs.readdirSync(STATE_DIR)) {
    const p = path.join(STATE_DIR, f);
    if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.rmSync(p, { force: true });
  }
  fs.writeFileSync(marker(input.session_id), '');
}

function check(input) {
  const file = input.tool_input?.file_path || '';
  if (!UI_EXT.test(file) || TEST_FILE.test(file)) return 0;
  if (input.session_id && fs.existsSync(marker(input.session_id))) return 0;
  process.stderr.write(
    '화면 파일을 고치기 전에 design-guide 스킬을 먼저 호출하세요 ' +
    '(프로젝트에 design-gate가 있으면 그것). 셸 명령으로 우회하지 마세요.\n');
  return 2;
}

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const mode = process.argv[2];
  if (mode === 'record') { record(input); process.exit(0); }
  process.exit(mode === 'check' ? check(input) : 0);
});
