/**
 * 설정. 여기 값만 바꿔서 쓰면 된다.
 * Claude API 키는 코드에 넣지 말고 setup() 안내대로 스크립트 속성 ANTHROPIC_API_KEY 에 저장한다.
 */
const CONFIG = {
  // 우리 회사 이름. 돈이 "나가는" 쪽인지 "들어오는" 쪽인지 판별하는 데 쓴다.
  COMPANY_NAME: '우리회사',

  // 할 일을 넣을 Google Tasks 목록 이름 (없으면 setup()에서 만든다)
  TASK_LIST_TITLE: '비용 지급 일정',

  // 처음 실행할 때 며칠 전 변경분부터 볼지
  FIRST_RUN_LOOKBACK_DAYS: 7,

  // 트리거 실행 간격(분). Apps Script 허용값: 1, 5, 10, 15, 30
  TRIGGER_MINUTES: 15,

  // 메일도 볼지 (본인 메일함만 읽는다. 읽음 표시는 바꾸지 않는다)
  GMAIL_ENABLED: true,

  // 파일 이름·메일 제목·첨부 이름에 이 단어가 있으면 비용 문서 후보로 본다
  NAME_KEYWORDS: [
    '견적', '계약', '대관', '임대', '임차', '용역', '청구', '인보이스', 'invoice',
    'quotation', 'quote', '발주', '구매', '지급', '지출', '세금계산서', '거래명세', '정산',
  ],

  // 이름에 키워드가 없어도, 본문에 아래 단어가 2개 이상 + 금액 표기가 있으면 후보로 본다
  CONTENT_KEYWORDS: [
    '지급', '합계', '총액', '총 금액', '견적금액', '계약금', '잔금', '중도금', '대관료',
    '임대료', '부가세', 'VAT', '공급가액', '입금', '결제', '청구금액',
  ],

  // Claude 설정
  MODEL: 'claude-opus-5-5',
  // 추출 작업이라 low로 둔다. 금액·날짜를 자주 놓치면 'medium'으로 올린다.
  EFFORT: 'low',
  MAX_OUTPUT_TOKENS: 8000,

  // 한도
  MAX_FILE_BYTES: 20 * 1024 * 1024, // PDF 등 원본을 Claude에 보낼 최대 크기
  MAX_IMAGE_BYTES: 5 * 1024 * 1024, // 이미지 1장 최대 크기 (API 한도)
  MAX_TEXT_CHARS: 150000, // 이보다 긴 문서는 앞부분만 보내고 할 일 메모에 표시한다
  MAX_FAILURES: 3, // 같은 문서가 이만큼 실패하면 "직접 확인" 할 일을 만들고 넘어간다
  RUN_BUDGET_MS: 4.5 * 60 * 1000, // Apps Script 1회 실행 한도(6분) 안에서 멈출 시점
};
