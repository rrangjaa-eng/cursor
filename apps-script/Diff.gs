/**
 * 문서 변경분 추출 (순수 함수 — Node 테스트 대상).
 *
 * 줄 단위 다중집합 비교: 새로 생긴 줄은 '+ ', 사라진 줄은 '- '로 표시한다.
 * 순서 이동은 변경으로 보지 않는다. 빈 줄은 무시한다.
 * maxChars를 넘으면 잘라내고 '(이하 생략)'을 붙인다.
 */
function diffLines(oldText, newText, maxChars) {
  var limit = maxChars || 4000;
  var oldLines = splitLines_(oldText);
  var newLines = splitLines_(newText);

  var counts = {};
  oldLines.forEach(function (l) { counts[l] = (counts[l] || 0) + 1; });

  var added = [];
  newLines.forEach(function (l) {
    if (counts[l] > 0) counts[l]--;
    else added.push(l);
  });

  var removed = [];
  oldLines.forEach(function (l) {
    if (counts[l] > 0) {
      removed.push(l);
      counts[l]--;
    }
  });

  var out = added.map(function (l) { return '+ ' + l; })
    .concat(removed.map(function (l) { return '- ' + l; }))
    .join('\n');

  return {
    added: added.length,
    removed: removed.length,
    text: truncate(out, limit)
  };
}

function splitLines_(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(function (l) { return l.replace(/\s+$/, ''); })
    .filter(function (l) { return l.trim() !== ''; });
}

function truncate(text, maxChars) {
  var s = String(text || '');
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '\n…(이하 생략)';
}
