// 실행: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, fixture, FakeBlob } = require('./harness');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString(); // 앞선 실행 이후에 수정된 것처럼

function claudeOk(result) {
  return () => ({
    code: 200,
    json: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(result) }] },
  });
}

const RENTAL_RESULT = {
  is_payment_document: true,
  document_type: '계약서',
  counterparty: '그랜드홀',
  summary: '11월 20일 행사 대관 계약. 계약금과 잔금으로 나눠 지급.',
  payments: [
    { description: '대관료 계약금', amount: 1100000, currency: 'KRW', vat: '포함', due_date: '2026-10-10', due_basis: '계약일에 지급' },
    { description: '대관료 잔금', amount: 4400000, currency: 'KRW', vat: '포함', due_date: '2026-11-13', due_basis: '행사 7일 전까지' },
  ],
};

function file(id, name, mimeType, content, modifiedTime) {
  return { id, name, mimeType, size: String(content.length), modifiedTime, webViewLink: 'https://drive/' + id, lastModifyingUser: { displayName: '김직원' }, content };
}

// ---------- 형식별 읽기 ----------

test('docx 견적서에서 표와 문단 텍스트를 읽는다', () => {
  const env = createEnv();
  const r = env.get('readBlob_')(new FakeBlob(fixture('quote_v1.docx')), 'quote.docx', DOCX);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /합계금액\t+3,300,000/);
  assert.match(r.text, /지급기한: 2026년 10월 31일/);
});

test('xlsx는 시트 이름과 날짜 서식 셀을 날짜로 읽는다', () => {
  const env = createEnv();
  const r = env.get('readBlob_')(new FakeBlob(fixture('catering.xlsx')), 'catering.xlsx', XLSX);
  assert.match(r.text, /\[시트: 견적\]/);
  assert.match(r.text, /합계\t1320000/);
  assert.match(r.text, /결제일\t2026-11-05/);
});

test('hwpx 본문을 읽고 XML 엔티티를 푼다', () => {
  const env = createEnv();
  const r = env.get('readBlob_')(new FakeBlob(fixture('rental.hwpx')), 'rental.hwpx', 'application/octet-stream');
  assert.match(r.text, /대관료 합계 5,500,000원/);
  assert.match(r.text, /A&B 홀\t끝/);
});

test('hwp(바이너리)는 읽을 수 없다고 이유를 남긴다', () => {
  const env = createEnv();
  const r = env.get('readBlob_')(new FakeBlob(Buffer.from('x')), '견적서.hwp', 'application/x-hwp');
  assert.equal(r.kind, 'unreadable');
  assert.match(r.reason, /hwp/);
});

// ---------- 규칙 추출 ----------

test('규칙: 금액·기한이 하나씩 분명하면 확정한다', () => {
  const env = createEnv();
  const r = env.get('ruleExtract_')('견적서\n공급가액 3,000,000\n합계금액 3,300,000원 (VAT 포함)\n지급기한: 2026.10.31', '2026-10-01T00:00:00Z', '견적서');
  assert.equal(r.ok, true);
  assert.equal(r.payment.amount, 3300000);
  assert.equal(r.payment.due_date, '2026-10-31');
  assert.equal(r.payment.vat, '포함');
  assert.equal(r.documentType, '견적서');
});

test('규칙: 만원 단위와 연도 없는 날짜', () => {
  const env = createEnv();
  const r = env.get('ruleExtract_')('총액 330만원\n결제일 1월 15일', '2026-12-20T00:00:00Z', '');
  assert.equal(r.ok, true);
  assert.equal(r.payment.amount, 3300000);
  assert.equal(r.payment.due_date, '2027-01-15'); // 반년 넘게 과거면 다음 해
});

test('규칙: 애매하면 확정하지 않는다(→ Claude)', () => {
  const rule = createEnv().get('ruleExtract_');
  assert.match(rule('합계 1,000,000\n계약금 300,000원\n지급일 2026-10-10', ago(0)).reason, /분할/);
  assert.match(rule('합계 1,000,000\n지급기한: 행사 7일 전까지', ago(0)).reason, /상대 기한/);
  assert.match(rule('합계 1,000,000\n합계 2,000,000\n지급일 2026-10-10', ago(0)).reason, /여러 개/);
  assert.match(rule('합계 1,000,000', ago(0)).reason, /기한을 찾지 못함/);
  assert.match(rule('지급일 2026-10-10', ago(0)).reason, /금액을 찾지 못함/);
});

test('금액 표기', () => {
  const f = createEnv().get('formatAmount_');
  assert.equal(f(3300000, 'KRW'), '3,300,000원');
  assert.equal(f(1234.5, 'USD'), '1,234.5 USD');
  assert.equal(f(null, 'KRW'), '금액 미확인');
});

// ---------- 전체 흐름 ----------

test('전체 흐름: 규칙·Claude·직접 확인·건너뛰기', () => {
  const env = createEnv();
  env.props.ANTHROPIC_API_KEY = 'sk-test';
  env.claudeResponder = claudeOk(RENTAL_RESULT);
  env.driveFiles.push(
    file('a', '한빛음향_견적서.docx', DOCX, fixture('quote_v1.docx'), ago(60)),
    file('b', '그랜드홀 대관계약서.pdf', 'application/pdf', fixture('fake.pdf'), ago(50)),
    file('c', '주간회의록.docx', DOCX, fixture('minutes.docx'), ago(40)),
    file('d', '케이터링 견적서.hwp', 'application/x-hwp', Buffer.from('hwp'), ago(30)),
    file('e', 'IMG_0001.jpg', 'image/jpeg', Buffer.from('jpg'), ago(20)),
    file('f', '행사 준비.xlsx', XLSX, fixture('catering.xlsx'), ago(10)) // 이름에 키워드 없음 → 내용으로 판별
  );

  env.get('run')();

  const all = Object.values(env.tasks);
  const titles = all.map((t) => t.title).sort();
  assert.deepEqual(titles, [
    '[직접 확인] 케이터링 견적서.hwp',
    '그랜드홀 대관료 계약금 · 1,100,000원',
    '그랜드홀 대관료 잔금 · 4,400,000원',
    '지급 · 1,320,000원',
    '지급 · 3,300,000원',
  ]);
  assert.equal(env.taskLists[0].title, '비용 지급 일정');

  const quote = all.find((t) => t.title === '지급 · 3,300,000원');
  assert.equal(quote.due, '2026-10-31T00:00:00.000Z');
  assert.match(quote.notes, /추출 방식: 규칙/);
  assert.match(quote.notes, /올린·수정한 사람: 김직원/);
  assert.match(quote.notes, /링크: https:\/\/drive\/a/);

  // PDF 한 건만 Claude로 갔다
  assert.equal(env.claudeRequests.length, 1);
  const req = env.claudeRequests[0];
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.messages[0].content[0].type, 'document');
  assert.ok(!('thinking' in req.body));

  // 이름에 키워드가 없는 사진과 회의록은 Claude로 보내지 않았고, 사진은 내려받지도 않았다
  assert.ok(!env.downloads.includes('e'));
  assert.ok(env.downloads.includes('c'));

  // 두 번째 실행: 바뀐 게 없으면 아무것도 하지 않는다
  env.get('run')();
  assert.equal(Object.keys(env.tasks).length, 5);
  assert.equal(env.claudeRequests.length, 1);
});

test('문서가 수정되면 완료 안 한 할 일만 바꾸고, 결과가 같으면 그대로 둔다', () => {
  const env = createEnv();
  env.props.ANTHROPIC_API_KEY = 'sk-test';
  env.claudeResponder = claudeOk(RENTAL_RESULT);
  env.driveFiles.push(
    file('a', '견적서.docx', DOCX, fixture('quote_v1.docx'), ago(60)),
    file('b', '대관계약서.pdf', 'application/pdf', fixture('fake.pdf'), ago(50))
  );
  env.get('run')();
  assert.equal(Object.keys(env.tasks).length, 3);

  // 계약금 할 일은 완료 처리
  const deposit = Object.values(env.tasks).find((t) => /계약금/.test(t.title));
  deposit.status = 'completed';

  // 견적서 금액이 바뀌고, 계약서는 내용 변화 없이 다시 저장됨
  env.driveFiles[0] = file('a', '견적서.docx', DOCX, fixture('quote_v2.docx'), later(1));
  env.driveFiles[1] = file('b', '대관계약서.pdf', 'application/pdf', fixture('fake.pdf'), later(2));
  env.get('run')();

  const titles = Object.values(env.tasks).map((t) => t.title).sort();
  assert.deepEqual(titles, ['그랜드홀 대관료 계약금 · 1,100,000원', '그랜드홀 대관료 잔금 · 4,400,000원', '지급 · 3,850,000원']);
  assert.match(Object.values(env.tasks).find((t) => /3,850,000/.test(t.title)).notes, /다시 만든 할 일/);
  assert.equal(deposit.status, 'completed');
  assert.ok(env.tasks[deposit.id], '완료한 할 일은 지우지 않는다');
});

test('API 키가 없으면 PDF는 직접 확인 할 일로 만든다', () => {
  const env = createEnv();
  env.driveFiles.push(file('b', '대관계약서.pdf', 'application/pdf', fixture('fake.pdf'), ago(5)));
  env.get('run')();
  const t = Object.values(env.tasks);
  assert.equal(t.length, 1);
  assert.equal(t[0].title, '[직접 확인] 대관계약서.pdf');
  assert.match(t[0].notes, /API 키가 없어/);
  assert.equal(env.claudeRequests.length, 0);
});

test('Claude 오류가 계속되면 3번째 실행에서 직접 확인 할 일을 남기고 넘어간다', () => {
  const env = createEnv();
  env.props.ANTHROPIC_API_KEY = 'sk-test';
  env.claudeResponder = () => ({ code: 529, json: { error: { type: 'overloaded_error' } } });
  env.driveFiles.push(
    file('b', '대관계약서.pdf', 'application/pdf', fixture('fake.pdf'), ago(50)),
    file('a', '견적서.docx', DOCX, fixture('quote_v1.docx'), ago(40))
  );
  env.get('run')();
  assert.equal(Object.keys(env.tasks).length, 0, '실패한 파일 뒤는 다음 실행에서 처리');
  assert.equal(env.sleeps.length, 3);
  env.get('run')();
  assert.equal(Object.keys(env.tasks).length, 0);
  env.get('run')();
  const titles = Object.values(env.tasks).map((t) => t.title).sort();
  assert.deepEqual(titles, ['[직접 확인] 대관계약서.pdf', '지급 · 3,300,000원']);
  assert.match(Object.values(env.tasks).find((t) => /직접 확인/.test(t.title)).notes, /3회 실패/);
});

test('메일: 첨부 견적서를 읽고, 내가 보낸 메일과 관련 없는 메일은 건너뛴다', () => {
  const env = createEnv();
  const now = Date.now();
  env.mails.push(
    { id: 'm1', threadId: 't1', subject: '케이터링 견적 송부', from: '업체 <vendor@x.com>', date: new Date(now - 3600e3), body: '첨부 확인 부탁드립니다.',
      attachments: [{ name: 'catering.xlsx', type: XLSX, content: fixture('catering.xlsx') }] },
    { id: 'm2', threadId: 't2', subject: '점심 메뉴', from: '동료 <a@x.com>', date: new Date(now - 1800e3), body: '오늘 뭐 먹죠?' },
    { id: 'm3', threadId: 't3', subject: '견적서 보냅니다', from: '나 <me@example.com>', date: new Date(now - 600e3), body: '합계 1,000,000원 지급일 2026-10-10' }
  );
  env.get('run')();
  const t = Object.values(env.tasks);
  assert.equal(t.length, 1);
  assert.equal(t[0].title, '지급 · 1,320,000원');
  assert.equal(t[0].due, '2026-11-05T00:00:00.000Z');
  assert.match(t[0].notes, /보낸 사람: 업체/);
  assert.match(t[0].notes, /mail\.google\.com\/mail\/u\/0\/#all\/t1/);
});

test('dryRun은 할 일도 처리 기록도 만들지 않는다', () => {
  const env = createEnv();
  env.driveFiles.push(file('a', '견적서.docx', DOCX, fixture('quote_v1.docx'), ago(5)));
  env.get('dryRun')();
  assert.equal(Object.keys(env.tasks).length, 0);
  assert.equal(env.taskLists.length, 0);
  assert.deepEqual(Object.keys(env.props), []);
});
