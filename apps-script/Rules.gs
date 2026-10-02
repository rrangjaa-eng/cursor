/**
 * 규칙 1차 판정 (순수 함수 — Node 테스트 대상).
 *
 * item: { source: 'gmail'|'drive', from, title, text, driveName, actorEmail }
 * rules: [{ type, value }]
 *   exclude_sender  : 발신자/수정자 이메일에 value 포함 (예: noreply, @news.example.com)
 *   exclude_keyword : 제목·본문에 value 포함
 *   exclude_drive   : 공유 드라이브 이름 또는 ID 일치
 *   include_sender  : 발신자/수정자 이메일에 value 포함
 *   include_keyword : 제목·본문에 value 포함
 *   include_drive   : 공유 드라이브 이름 또는 ID 일치
 * profile: { name, aliases: [], email }
 *
 * 반환: { decision: 'exclude'|'include'|'ask', reason }
 * 순서: exclude > include(본인 언급 포함) > ask
 */
function evaluateRules(item, rules, profile) {
  var sender = lower_(item.source === 'gmail' ? item.from : item.actorEmail);
  var haystack = lower_((item.title || '') + '\n' + (item.text || ''));
  var drive = item.driveName || '';
  var driveId = item.driveId || '';

  var byType = {};
  (rules || []).forEach(function (r) {
    var type = String(r.type || '').trim();
    var value = String(r.value || '').trim();
    if (!type || !value) return;
    (byType[type] = byType[type] || []).push(value);
  });

  function hit(type, test) {
    var list = byType[type] || [];
    for (var i = 0; i < list.length; i++) {
      if (test(list[i])) return list[i];
    }
    return null;
  }
  function inSender(v) { return sender && sender.indexOf(lower_(v)) !== -1; }
  function inText(v) { return haystack.indexOf(lower_(v)) !== -1; }
  function isDrive(v) { return item.source === 'drive' && (v === drive || v === driveId); }

  var m;
  if ((m = hit('exclude_sender', inSender))) return { decision: 'exclude', reason: '제외 발신자: ' + m };
  if ((m = hit('exclude_drive', isDrive))) return { decision: 'exclude', reason: '제외 드라이브: ' + m };
  if ((m = hit('exclude_keyword', inText))) return { decision: 'exclude', reason: '제외 키워드: ' + m };

  var mention = findMention_(haystack, profile);
  if (mention) return { decision: 'include', reason: '본인 언급: ' + mention };
  if ((m = hit('include_sender', inSender))) return { decision: 'include', reason: '지정 발신자: ' + m };
  if ((m = hit('include_drive', isDrive))) return { decision: 'include', reason: '지정 드라이브: ' + m };
  if ((m = hit('include_keyword', inText))) return { decision: 'include', reason: '지정 키워드: ' + m };

  return { decision: 'ask', reason: '규칙 미해당' };
}

function findMention_(haystack, profile) {
  if (!profile) return null;
  var names = [profile.name, profile.email].concat(profile.aliases || []);
  for (var i = 0; i < names.length; i++) {
    var n = lower_(names[i]).trim();
    if (n && haystack.indexOf(n) !== -1) return names[i];
  }
  return null;
}

function lower_(s) {
  return String(s || '').toLowerCase();
}
