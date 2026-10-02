/**
 * 규칙 기반 추출(무료). 금액·기한이 각각 하나로 분명할 때만 결과를 낸다.
 * 애매하면 {ok:false, reason}을 돌려주고, 호출하는 쪽이 Claude API로 넘긴다.
 * 순수 함수라 Node 테스트로 검증한다.
 */

// 앞에 있을수록 우선한다 (최종 합계 → 일반 합계 순)
const TOTAL_KEYWORDS = [
  '최종지급액', '최종금액', '총견적금액', '총합계', '합계금액', '청구금액', '견적금액',
  '계약금액', '총금액', '총액', '합계',
];
const DUE_KEYWORDS = [
  '지급기한', '지급일', '지급일자', '지급예정일', '납부기한', '납부일', '결제기한', '결제일',
  '입금기한', '입금일', '지불기한', '지불일',
];
const INSTALLMENT_RE = /계약금|중도금|잔금|선금|선급금|분할\s*(지급|납부)|\d+\s*회차/;
const RELATIVE_DUE_RE = /\d+\s*일\s*(전|이내|후|내)|익월|말일|월말|영업일/;
const DOC_TYPES = ['세금계산서', '견적서', '계약서', '청구서', '발주서', '거래명세서'];

function compact_(s) {
  return String(s).replace(/\s+/g, '');
}

/** text: 문서 텍스트, refIso: 기준 시각(문서 수정 시각) */
function ruleExtract_(text, refIso, title) {
  if (INSTALLMENT_RE.test(text)) return { ok: false, reason: '분할 지급 조건이 있음' };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1) 금액
  let amount = null;
  let amountLine = '';
  for (let k = 0; k < TOTAL_KEYWORDS.length && amount === null; k++) {
    const kw = TOTAL_KEYWORDS[k];
    const found = [];
    lines.forEach((line, i) => {
      if (compact_(line).indexOf(kw) === -1) return;
      let amounts = amountsIn_(line);
      if (!amounts.length && lines[i + 1]) amounts = amountsIn_(lines[i + 1]);
      if (amounts.length) found.push({ amount: Math.max.apply(null, amounts), line: line });
    });
    if (!found.length) continue;
    const distinct = unique_(found.map((f) => f.amount));
    if (distinct.length > 1) return { ok: false, reason: '"' + kw + '" 금액 후보가 여러 개' };
    amount = distinct[0];
    amountLine = found[0].line;
  }
  if (amount === null) return { ok: false, reason: '최종 금액을 찾지 못함' };

  // 2) 기한
  const ref = new Date(refIso);
  const dues = [];
  let relative = false;
  lines.forEach((line, i) => {
    const c = compact_(line);
    if (!DUE_KEYWORDS.some((k) => c.indexOf(k) !== -1)) return;
    let dates = datesIn_(line, ref);
    if (!dates.length && lines[i + 1]) dates = datesIn_(lines[i + 1], ref);
    if (!dates.length && RELATIVE_DUE_RE.test(line)) relative = true;
    dates.forEach((d) => dues.push({ date: d, line: line }));
  });
  if (relative) return { ok: false, reason: '상대 기한이 있음' };
  const distinctDues = unique_(dues.map((d) => d.date));
  if (!distinctDues.length) return { ok: false, reason: '지급 기한을 찾지 못함' };
  if (distinctDues.length > 1) return { ok: false, reason: '지급 기한 후보가 여러 개' };

  return {
    ok: true,
    documentType: docTypeOf_(String(title || '') + '\n' + text),
    payment: {
      description: '지급',
      amount: amount,
      currency: 'KRW',
      vat: vatOf_(amountLine, text),
      due_date: distinctDues[0],
      due_basis: dues[0].line.slice(0, 120),
    },
  };
}

/** 줄에서 금액으로 보이는 숫자들 (원 단위) */
function amountsIn_(line) {
  // 날짜·전화번호가 금액으로 잡히지 않게 먼저 지운다
  const s = line
    .replace(/20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g, ' ')
    .replace(/\d{2,4}-\d{3,4}-\d{4}/g, ' ');
  const out = [];
  let m;
  const manRe = /(\d+(?:\.\d+)?)\s*만\s*원/g; // 330만원
  while ((m = manRe.exec(s))) out.push(Math.round(Number(m[1]) * 10000));
  const rest = s.replace(manRe, ' ');
  const numRe = /\d{1,3}(?:,\d{3})+|\d{4,}/g; // 3,300,000 또는 3300000
  while ((m = numRe.exec(rest))) out.push(Number(m[0].replace(/,/g, '')));
  return out.filter((n) => n >= 1000);
}

/** 줄에서 날짜들(YYYY-MM-DD). 연도가 없으면 기준일 연도로 보고, 반년 넘게 과거면 다음 해로 본다 */
function datesIn_(line, ref) {
  const out = [];
  let m;
  const full = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g;
  while ((m = full.exec(line))) pushDate_(out, Number(m[1]), Number(m[2]), Number(m[3]));
  const noYear = line.replace(full, ' ');
  const md = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while ((m = md.exec(noYear))) {
    let year = ref.getFullYear();
    const candidate = new Date(year, Number(m[1]) - 1, Number(m[2]));
    if (ref - candidate > 183 * 86400000) year += 1;
    pushDate_(out, year, Number(m[1]), Number(m[2]));
  }
  return out;
}

function pushDate_(out, y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return;
  out.push(date.toISOString().slice(0, 10));
}

function vatOf_(amountLine, text) {
  const pick = (s) => {
    if (/(부가세|부가가치세|VAT)\s*(포함|included)/i.test(s)) return '포함';
    if (/(부가세|부가가치세|VAT)\s*(별도|미포함|excluded)/i.test(s)) return '별도';
    return null;
  };
  return pick(amountLine) || pick(text) || '불명';
}

function docTypeOf_(s) {
  for (let i = 0; i < DOC_TYPES.length; i++) if (s.indexOf(DOC_TYPES[i]) !== -1) return DOC_TYPES[i];
  return '기타';
}

function unique_(arr) {
  return arr.filter((v, i) => arr.indexOf(v) === i);
}
