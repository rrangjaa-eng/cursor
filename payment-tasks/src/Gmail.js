/**
 * 본인 메일함의 새 메일 수집. 읽음 표시·라벨 등 메일 상태는 바꾸지 않는다.
 */

function listNewMessages_(sinceIso) {
  const since = new Date(sinceIso).getTime();
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const query = 'after:' + Math.floor(since / 1000) + ' -in:chats -in:spam -in:trash';
  const seen = {};
  const out = [];
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    threads.forEach((th) => {
      th.getMessages().forEach((m) => {
        const id = m.getId();
        if (seen[id] || m.getDate().getTime() < since || m.isInTrash()) return;
        if (me && m.getFrom().toLowerCase().indexOf(me) !== -1) return; // 내가 보낸 메일 제외
        seen[id] = true;
        out.push(m);
      });
    });
    if (threads.length < 100) break;
  }
  return out.sort((a, b) => a.getDate() - b.getDate());
}

/** 메일 하나를 분석 대상(source)으로 만든다. 비용 관련 후보가 아니면 null */
function buildGmailSource_(msg) {
  const subject = msg.getSubject() || '(제목 없음)';
  const attachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  const nameHit = matchesNameKeywords_(subject) || attachments.some((a) => matchesNameKeywords_(a.getName()));

  const parts = [{ label: '메일 본문', read: { kind: 'text', text: msg.getPlainBody() || '' } }];
  attachments.forEach((a) => {
    const name = a.getName();
    const type = a.getContentType();
    if (!nameHit && !isTextCheckable_(name, type)) return;
    parts.push({ label: '첨부: ' + name, read: readBlob_(a, name, type) });
  });

  if (!nameHit) {
    const allText = parts.filter((p) => p.read.kind === 'text').map((p) => p.read.text).join('\n');
    if (!looksLikeCostContent_(allText)) return null;
  }
  return Object.assign(gmailStub_(msg), { parts: parts });
}

function gmailStub_(msg) {
  const subject = msg.getSubject() || '(제목 없음)';
  return {
    title: '메일: ' + subject,
    link: 'https://mail.google.com/mail/u/0/#all/' + msg.getThread().getId(),
    refDate: msg.getDate().toISOString(),
    meta: ['보낸 사람: ' + msg.getFrom(), '받은 시각: ' + toKst_(msg.getDate().toISOString())],
    nameHit: matchesNameKeywords_(subject),
  };
}
