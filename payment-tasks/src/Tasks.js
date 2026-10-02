/**
 * Google Tasks 등록.
 */

function getTaskListId_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('taskListId');
  if (cached) return cached;
  const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];
  const found = lists.filter((l) => l.title === CONFIG.TASK_LIST_TITLE)[0];
  const id = found ? found.id : Tasks.Tasklists.insert({ title: CONFIG.TASK_LIST_TITLE }).id;
  props.setProperty('taskListId', id);
  return id;
}

function insertTask_(listId, task) {
  if (DRY_RUN) {
    console.log('[미리보기] 할 일: ' + JSON.stringify(task));
    return 'dry-run';
  }
  return Tasks.Tasks.insert(task, listId).id;
}

/** 아직 완료하지 않은 할 일만 지운다. 이미 지워진 할 일은 무시한다 */
function removeOpenTasks_(listId, taskIds) {
  (taskIds || []).forEach((id) => {
    if (DRY_RUN || id === 'dry-run') return;
    try {
      const t = Tasks.Tasks.get(listId, id);
      if (t.status !== 'completed') Tasks.Tasks.remove(listId, id);
    } catch (e) {
      // 사용자가 이미 지운 할 일
    }
  });
}

/** 지급 1건 → Tasks 항목 (순수 함수) */
function formatPaymentTask_(source, result, payment, opts) {
  const amountText = formatAmount_(payment.amount, payment.currency);
  const head = payment.due_date ? '' : '[기한 미정] ';
  const who = result.counterparty ? result.counterparty + ' ' : '';
  const title = (head + who + payment.description + ' · ' + amountText).slice(0, 1000);

  const lines = [
    '지급 금액: ' + amountText + (payment.vat && payment.vat !== '불명' ? ' (부가세 ' + payment.vat + ')' : ''),
    '지급 기한: ' + (payment.due_date || '미정') + (payment.due_basis ? ' — 근거: "' + payment.due_basis + '"' : ''),
  ];
  if (result.counterparty) lines.push('상대방: ' + result.counterparty);
  lines.push('문서 종류: ' + result.document_type);
  if (result.summary) lines.push('요약: ' + result.summary);
  lines.push('추출 방식: ' + (opts.mode === 'rule' ? '규칙(원문 확인 권장)' : 'Claude'));
  lines.push('', '출처: ' + source.title);
  source.meta.forEach((m) => lines.push(m));
  lines.push('링크: ' + source.link);
  (result.notes || []).forEach((n) => lines.push('※ ' + n));
  if (opts.updated) lines.push('※ 문서가 바뀌어 다시 만든 할 일입니다.');

  const task = { title: title, notes: lines.join('\n').slice(0, 8000) };
  if (payment.due_date) task.due = payment.due_date + 'T00:00:00.000Z';
  return task;
}

/** 자동으로 확정하지 못한 문서 → "직접 확인" 할 일 (순수 함수) */
function formatManualTask_(source, reason, opts) {
  const lines = ['자동으로 금액·기한을 확정하지 못했습니다.', '이유: ' + reason, '', '출처: ' + source.title];
  source.meta.forEach((m) => lines.push(m));
  lines.push('링크: ' + source.link);
  if (opts && opts.updated) lines.push('※ 문서가 바뀌어 다시 만든 할 일입니다.');
  return { title: ('[직접 확인] ' + source.title).slice(0, 1000), notes: lines.join('\n').slice(0, 8000) };
}

function formatAmount_(amount, currency) {
  if (amount === null || amount === undefined) return '금액 미확인';
  const parts = String(Math.round(amount * 100) / 100).split('.');
  const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
  return !currency || currency === 'KRW' ? grouped + '원' : grouped + ' ' + currency;
}
