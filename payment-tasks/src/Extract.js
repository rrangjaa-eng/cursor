/**
 * 파일 내용 읽기와 "비용 문서 후보인가" 1차 판별.
 * 아래 *_Xml / *Text_ 함수들은 Google 서비스를 쓰지 않는 순수 함수라 Node 테스트로 검증한다.
 */

const MIME = {
  GDOC: 'application/vnd.google-apps.document',
  GSHEET: 'application/vnd.google-apps.spreadsheet',
  GSLIDES: 'application/vnd.google-apps.presentation',
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// ---------- 1차 판별 ----------

function matchesNameKeywords_(name) {
  const lower = String(name || '').toLowerCase();
  return CONFIG.NAME_KEYWORDS.some((k) => lower.indexOf(k.toLowerCase()) !== -1);
}

function looksLikeCostContent_(text) {
  if (!text) return false;
  const hits = CONFIG.CONTENT_KEYWORDS.filter((k) => text.indexOf(k) !== -1).length;
  // 쉼표 금액, "원" 표기, 또는 쉼표 없는 5자리 이상 숫자(엑셀 셀 값)
  const hasAmount = /\d{1,3}(,\d{3})+|\d+\s*(원|만\s*원|천\s*원)|₩\s*\d|\d{5,}/.test(text);
  return hits >= 2 && hasAmount;
}

/** 내용을 열어보지 않고는 판별할 수 없는(=이름 키워드가 있을 때만 여는) 형식인지 */
function isTextCheckable_(name, mimeType) {
  const ext = extOf_(name);
  return (
    [MIME.GDOC, MIME.GSHEET, MIME.GSLIDES, MIME.DOCX, MIME.XLSX].indexOf(mimeType) !== -1 ||
    ['docx', 'xlsx', 'xlsm', 'hwpx', 'txt', 'csv'].indexOf(ext) !== -1 ||
    String(mimeType).indexOf('text/') === 0
  );
}

function extOf_(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// ---------- 형식별 읽기 ----------

/**
 * Blob 하나를 Claude에 보낼 수 있는 형태로 바꾼다.
 * 반환: {kind:'text', text} | {kind:'pdf', base64} | {kind:'image', base64, mediaType} | {kind:'unreadable', reason}
 */
function readBlob_(blob, name, mimeType) {
  const ext = extOf_(name);
  const bytes = blob.getBytes().length;

  if (mimeType === MIME.PDF || ext === 'pdf') {
    if (bytes > CONFIG.MAX_FILE_BYTES) return { kind: 'unreadable', reason: 'PDF가 너무 큽니다(' + mb_(bytes) + ').' };
    return { kind: 'pdf', base64: Utilities.base64Encode(blob.getBytes()) };
  }
  if (IMAGE_TYPES.indexOf(mimeType) !== -1) {
    if (bytes > CONFIG.MAX_IMAGE_BYTES) return { kind: 'unreadable', reason: '이미지가 너무 큽니다(' + mb_(bytes) + ').' };
    return { kind: 'image', base64: Utilities.base64Encode(blob.getBytes()), mediaType: mimeType };
  }
  if (mimeType === MIME.DOCX || ext === 'docx') {
    const files = unzipToMap_(blob, /^word\/document\.xml$/);
    return { kind: 'text', text: docxXmlToText_(files['word/document.xml'] || '') };
  }
  if (mimeType === MIME.XLSX || ext === 'xlsx' || ext === 'xlsm') {
    return { kind: 'text', text: xlsxToText_(unzipToMap_(blob, /^xl\/(sharedStrings|workbook|styles)\.xml$|^xl\/_rels\/workbook\.xml\.rels$|^xl\/worksheets\/[^/]+\.xml$/)) };
  }
  if (ext === 'hwpx') {
    const files = unzipToMap_(blob, /^Contents\/section\d+\.xml$/);
    const sections = Object.keys(files).sort(bySectionNumber_);
    return { kind: 'text', text: sections.map((p) => hwpxXmlToText_(files[p])).join('\n') };
  }
  if (String(mimeType).indexOf('text/') === 0 || ext === 'txt' || ext === 'csv') {
    return { kind: 'text', text: blob.getDataAsString('UTF-8') };
  }
  if (ext === 'hwp') {
    return { kind: 'unreadable', reason: '한글(.hwp) 파일은 자동으로 읽을 수 없습니다. HWPX나 PDF로 저장되면 읽을 수 있습니다.' };
  }
  return { kind: 'unreadable', reason: '자동으로 읽을 수 없는 형식입니다(' + (ext || mimeType) + ').' };
}

function unzipToMap_(blob, pathFilter) {
  const zip = blob.copyBlob().setContentType('application/zip');
  const out = {};
  Utilities.unzip(zip).forEach((entry) => {
    const path = entry.getName();
    if (pathFilter.test(path)) out[path] = entry.getDataAsString('UTF-8');
  });
  return out;
}

function bySectionNumber_(a, b) {
  return Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]);
}

function mb_(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

// ---------- XML → 텍스트 (순수 함수) ----------

function decodeXml_(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tidyText_(s) {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 표는 한 행을 한 줄로(셀은 탭으로) 바꾼다. "합계금액 | 3,300,000"이 같은 줄에 있어야 규칙 추출이 된다.
 * ns: 'w'(docx) 또는 'hp'(hwpx)
 */
function tableRowsToLines_(xml, ns) {
  const rowRe = new RegExp('<' + ns + ':tr\\b[\\s\\S]*?</' + ns + ':tr>', 'g');
  const cellRe = new RegExp('<' + ns + ':tc\\b[\\s\\S]*?</' + ns + ':tc>', 'g');
  const paraEnd = new RegExp('</' + ns + ':p>', 'g');
  return xml.replace(rowRe, (row) => {
    const cells = (row.match(cellRe) || []).map((cell) =>
      cell.replace(paraEnd, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );
    return cells.filter((c) => c).join('\t') + '\n';
  });
}

function docxXmlToText_(xml) {
  const text = tableRowsToLines_(xml.replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, ''), 'w') // 필드 코드(PAGE 등) 제거
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return tidyText_(decodeXml_(text));
}

function hwpxXmlToText_(xml) {
  const text = tableRowsToLines_(xml.replace(/<hp:tab[^>]*\/>/g, '\t'), 'hp')
    .replace(/<hp:lineBreak[^>]*\/>/g, '\n')
    .replace(/<\/hp:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return tidyText_(decodeXml_(text));
}

/** files: { 'xl/workbook.xml': xml, 'xl/worksheets/sheet1.xml': xml, ... } */
function xlsxToText_(files) {
  const shared = parseSharedStrings_(files['xl/sharedStrings.xml'] || '');
  const dateStyles = parseDateStyles_(files['xl/styles.xml'] || '');
  const out = [];
  xlsxSheets_(files).forEach((sheet) => {
    const xml = files[sheet.path];
    if (!xml) return;
    const rows = [];
    (xml.match(/<row\b[\s\S]*?<\/row>/g) || []).forEach((rowXml) => {
      const cells = [];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let m;
      while ((m = cellRe.exec(rowXml))) {
        const value = xlsxCellValue_(m[1], m[2] || '', shared, dateStyles);
        if (value !== '') cells.push(value);
      }
      if (cells.length) rows.push(cells.join('\t'));
    });
    if (rows.length) out.push('[시트: ' + sheet.name + ']\n' + rows.join('\n'));
  });
  return out.join('\n\n');
}

function xlsxSheets_(files) {
  const rels = {};
  ((files['xl/_rels/workbook.xml.rels'] || '').match(/<Relationship\b[^>]*>/g) || []).forEach((r) => {
    const id = /\bId="([^"]+)"/.exec(r);
    const target = /\bTarget="([^"]+)"/.exec(r);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  });
  const sheets = [];
  ((files['xl/workbook.xml'] || '').match(/<sheet\b[^>]*>/g) || []).forEach((s) => {
    const name = /\bname="([^"]*)"/.exec(s);
    const rid = /\br:id="([^"]+)"/.exec(s);
    if (name && rid && rels[rid[1]]) sheets.push({ name: decodeXml_(name[1]), path: 'xl/' + rels[rid[1]] });
  });
  if (!sheets.length) {
    // workbook 정보가 없으면 시트 파일 순서대로
    Object.keys(files)
      .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
      .sort()
      .forEach((p, i) => sheets.push({ name: 'Sheet' + (i + 1), path: p }));
  }
  return sheets;
}

function parseSharedStrings_(xml) {
  return (xml.match(/<si\b[\s\S]*?<\/si>/g) || []).map((si) => {
    const noPhonetic = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const parts = noPhonetic.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || [];
    return decodeXml_(parts.map((t) => t.replace(/<[^>]+>/g, '')).join(''));
  });
}

/** 날짜 서식이 적용된 셀 스타일 번호(cellXfs 인덱스) 집합 */
function parseDateStyles_(xml) {
  const customDate = {};
  (xml.match(/<numFmt\b[^>]*>/g) || []).forEach((f) => {
    const id = /\bnumFmtId="(\d+)"/.exec(f);
    const code = /\bformatCode="([^"]*)"/.exec(f);
    if (id && code) {
      const bare = decodeXml_(code[1]).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      if (/[ymd]|년|월|일/i.test(bare)) customDate[id[1]] = true;
    }
  });
  const isBuiltinDate = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58);
  const result = {};
  const cellXfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml);
  if (!cellXfs) return result;
  (cellXfs[0].match(/<xf\b[^>]*>/g) || []).forEach((xf, index) => {
    const id = /\bnumFmtId="(\d+)"/.exec(xf);
    if (id && (customDate[id[1]] || isBuiltinDate(Number(id[1])))) result[index] = true;
  });
  return result;
}

function xlsxCellValue_(attrs, inner, shared, dateStyles) {
  const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
  const style = (/\bs="(\d+)"/.exec(attrs) || [])[1];
  if (type === 'inlineStr') {
    return decodeXml_((inner.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
  if (!v) return '';
  const raw = decodeXml_(v[1]);
  if (type === 's') return shared[Number(raw)] || '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (!type || type === 'n') {
    const num = Number(raw);
    if (style !== undefined && dateStyles[style] && isFinite(num)) return excelSerialToDate_(num);
  }
  return raw;
}

function excelSerialToDate_(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}
