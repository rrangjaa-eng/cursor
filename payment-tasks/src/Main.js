/**
 * 진입점.
 *  setup()     : 처음 한 번. 할 일 목록을 만들고 주기 실행 트리거를 건다.
 *  dryRun()    : 할 일을 만들지 않고 무엇을 만들지 로그로만 보여준다(처리 기록도 남기지 않음).
 *  run()       : 트리거가 주기적으로 실행한다.
 *  uninstall() : 트리거를 지운다.
 */

let DRY_RUN = false;

function setup() {
  getTaskListId_();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'run')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(CONFIG.TRIGGER_MINUTES).create();
  console.log('설정 완료: "' + CONFIG.TASK_LIST_TITLE + '" 목록, ' + CONFIG.TRIGGER_MINUTES + '분마다 실행');
  if (!hasApiKey_()) {
    console.log('Claude API 키가 없습니다. 규칙으로 확정하지 못한 문서는 "[직접 확인]" 할 일로 만듭니다.');
  }
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('트리거를 모두 지웠습니다.');
}

function run() {
  runOnce_();
}

function dryRun() {
  DRY_RUN = true;
  try {
    runOnce_();
  } finally {
    DRY_RUN = false;
  }
}

function runOnce_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('이전 실행이 아직 끝나지 않아 이번 실행은 건너뜁니다.');
    return;
  }
  try {
    const started = Date.now();
    const listId = DRY_RUN ? 'dry-run' : getTaskListId_();
    processDrive_(listId, started);
    if (CONFIG.GMAIL_ENABLED && !outOfTime_(started)) processGmail_(listId, started);
    pruneState_();
  } finally {
    lock.releaseLock();
  }
}

function outOfTime_(started) {
  return Date.now() - started > CONFIG.RUN_BUDGET_MS;
}

function processDrive_(listId, started) {
  const scanStart = new Date().toISOString();
  const files = listChangedSharedDriveFiles_(getCursor_('drive'));
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (outOfTime_(started)) return setCursor_('drive', f.modifiedTime);
    const stub = {
      title: f.name,
      link: f.webViewLink,
      meta: ['공유 드라이브: ' + f.driveName],
      nameHit: matchesNameKeywords_(f.name),
    };
    const status = processItem_('f:' + f.id, f.modifiedTime, stub, () => buildDriveSource_(f), listId);
    // 일시적 실패: 다음 실행 때 이 파일부터 다시 본다
    if (status === 'retry') return setCursor_('drive', f.modifiedTime);
  }
  setCursor_('drive', scanStart);
}

function processGmail_(listId, started) {
  const scanStart = new Date().toISOString();
  const messages = listNewMessages_(getCursor_('gmail'));
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const at = m.getDate().toISOString();
    if (outOfTime_(started)) return setCursor_('gmail', at);
    const status = processItem_('m:' + m.getId(), '1', gmailStub_(m), () => buildGmailSource_(m), listId);
    if (status === 'retry') return setCursor_('gmail', at);
  }
  setCursor_('gmail', scanStart);
}

/**
 * 파일·메일 하나를 처리한다. 반환: 'skip' | 'ok' | 'retry'
 *  - 같은 버전은 다시 처리하지 않는다.
 *  - 문서가 바뀌어 추출 결과가 달라지면, 완료하지 않은 이전 할 일을 지우고 새로 만든다.
 *  - 실패하면 다음 실행에서 다시 시도하고, MAX_FAILURES번 실패하면 "[직접 확인]" 할 일을 만들고 넘어간다.
 */
function processItem_(key, version, stub, makeSource, listId) {
  const prev = loadState_(key);
  if (prev && prev.v === version) return 'skip';
  try {
    const source = makeSource();
    if (!source) {
      if (prev) saveState_(key, { v: version, s: prev.s, t: prev.t });
      return 'skip';
    }
    const outcome = analyze_(source);
    const sig = outcome.mode === 'manual' ? 'manual' : hash_(JSON.stringify([outcome.result.is_payment_document, outcome.result.payments]));
    if (prev && prev.s === sig) {
      saveState_(key, { v: version, s: sig, t: prev.t });
      deleteState_('e:' + key);
      return 'ok';
    }
    const updated = !!(prev && prev.t && prev.t.length);
    removeOpenTasks_(listId, prev && prev.t);
    const ids = createTasksFor_(listId, source, outcome, updated);
    saveState_(key, { v: version, s: sig, t: ids });
    deleteState_('e:' + key);
    console.log(source.title + ' → ' + outcome.mode + ', 할 일 ' + ids.length + '개');
    return 'ok';
  } catch (e) {
    console.error(stub.title + ' 처리 실패: ' + (e && e.message));
    const err = loadState_('e:' + key);
    const failures = err && err.v === version ? err.n + 1 : 1;
    if (failures < CONFIG.MAX_FAILURES) {
      saveState_('e:' + key, { v: version, n: failures });
      return 'retry';
    }
    // 계속 실패하면 놓치지 않도록 직접 확인 할 일을 남기고 넘어간다(비용 문서로 보이는 경우만)
    const ids = stub.nameHit
      ? [insertTask_(listId, formatManualTask_(stub, '자동 처리 ' + failures + '회 실패: ' + (e && e.message)))]
      : [];
    saveState_(key, { v: version, s: 'failed', t: (prev && prev.t) || ids });
    deleteState_('e:' + key);
    return 'ok';
  }
}

/** 규칙 → (안 되면) Claude → (키가 없으면) 직접 확인 */
function analyze_(source) {
  const reads = source.parts.map((p) => p.read);
  const texts = reads.filter((r) => r.kind === 'text' && r.text.trim());
  const binaries = reads.filter((r) => r.kind === 'pdf' || r.kind === 'image');
  if (!texts.length && !binaries.length) {
    const why = reads.filter((r) => r.kind === 'unreadable').map((r) => r.reason);
    return { mode: 'manual', reason: why.join(' / ') || '읽을 수 있는 내용이 없음' };
  }

  let reason = 'PDF·이미지 문서';
  if (!binaries.length) {
    const r = ruleExtract_(texts.map((t) => t.text).join('\n\n'), source.refDate, source.title);
    if (r.ok) {
      return {
        mode: 'rule',
        result: { is_payment_document: true, document_type: r.documentType, counterparty: null, summary: '', payments: [r.payment], notes: [] },
      };
    }
    reason = r.reason;
  }
  if (!hasApiKey_()) return { mode: 'manual', reason: reason + ' (Claude API 키가 없어 자동 분석 생략)' };
  return { mode: 'claude', result: extractWithClaude_(source) };
}

function createTasksFor_(listId, source, outcome, updated) {
  if (outcome.mode === 'manual') {
    return [insertTask_(listId, formatManualTask_(source, outcome.reason, { updated: updated }))];
  }
  const r = outcome.result;
  if (!r.is_payment_document) return [];
  if (!r.payments.length) {
    return [insertTask_(listId, formatManualTask_(source, '비용 문서로 보이지만 금액·기한을 찾지 못함', { updated: updated }))];
  }
  return r.payments.map((p) => insertTask_(listId, formatPaymentTask_(source, r, p, { mode: outcome.mode, updated: updated })));
}
