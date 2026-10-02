/**
 * Claude Routine이 남긴 판단 파일 해석 (순수 함수 — Node 테스트 대상).
 *
 * 기대 형식:
 * {"decisions":[{"key":"gmail:abc","relevant":true,"title":"…","notes":"…","due":"2026-10-05","reason":"…"}]}
 *
 * 코드 블록(```json … ```)으로 감싸져 있어도 읽는다.
 * 반환: { decisions: [...유효한 항목], errors: [...문자열] }
 */
function parseDecisions(text) {
  var errors = [];
  var raw = String(text || '').trim();
  var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) raw = fenced[1].trim();

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { decisions: [], errors: ['JSON 파싱 실패: ' + e.message] };
  }

  var list = Array.isArray(data) ? data : data && data.decisions;
  if (!Array.isArray(list)) {
    return { decisions: [], errors: ['decisions 배열이 없음'] };
  }

  var decisions = [];
  list.forEach(function (d, i) {
    if (!d || typeof d.key !== 'string' || !d.key) {
      errors.push('#' + i + ': key 없음');
      return;
    }
    if (typeof d.relevant !== 'boolean') {
      errors.push(d.key + ': relevant가 true/false가 아님');
      return;
    }
    var title = String(d.title || '').trim();
    if (d.relevant && !title) {
      errors.push(d.key + ': 관련 항목인데 title 없음');
      return;
    }
    var due = String(d.due || '').trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      errors.push(d.key + ': due 형식 오류(' + due + ') — 기한 없이 등록');
      due = '';
    }
    decisions.push({
      key: d.key,
      relevant: d.relevant,
      title: title,
      notes: String(d.notes || '').trim(),
      due: due,
      reason: String(d.reason || '').trim()
    });
  });

  return { decisions: decisions, errors: errors };
}

/** Google Tasks due 형식 (날짜만 의미 있음). */
function toTaskDue(yyyyMmDd) {
  return yyyyMmDd ? yyyyMmDd + 'T00:00:00.000Z' : undefined;
}

/** 규칙으로 확정된 항목의 기본 할 일 제목. */
function defaultTaskTitle(item) {
  if (item.source === 'gmail') return '[메일] ' + (item.title || '(제목 없음)');
  var verb = item.kind === 'upload' ? '새 파일' : '문서 수정';
  return '[' + verb + '] ' + (item.title || '(이름 없음)');
}
