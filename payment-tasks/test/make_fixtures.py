"""테스트용 문서 생성. 실행: python3 test/make_fixtures.py (python-docx, openpyxl 필요)"""
import datetime
import os
import zipfile

import docx
import openpyxl

OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(OUT, exist_ok=True)


def quote_docx(path, total):
    d = docx.Document()
    d.add_heading("견 적 서", 0)
    d.add_paragraph("수신: 우리회사 귀중")
    d.add_paragraph("공급자: 한빛음향")
    t = d.add_table(rows=4, cols=3)
    rows = [("품목", "수량", "금액"), ("음향 장비 대여", "1", "3,000,000"),
            ("부가세", "", "300,000"), ("합계금액", "", f"{total:,}")]
    for r, values in enumerate(rows):
        for c, v in enumerate(values):
            t.cell(r, c).text = v
    d.add_paragraph("※ 부가세 포함 금액입니다.")
    d.add_paragraph("지급기한: 2026년 10월 31일")
    d.save(path)


def minutes_docx(path):
    d = docx.Document()
    d.add_heading("주간 회의록", 0)
    d.add_paragraph("1. 하반기 채용 일정 공유")
    d.add_paragraph("2. 사무실 좌석 배치 변경")
    d.save(path)


def plan_xlsx(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "견적"
    ws.append(["항목", "금액"])
    ws.append(["케이터링", 1200000])
    ws.append(["합계", 1320000])
    ws.append(["부가세 포함", None])
    ws["A5"] = "결제일"
    ws["B5"] = datetime.date(2026, 11, 5)
    ws["B5"].number_format = "yyyy-mm-dd"
    wb.save(path)


def hwpx(path):
    section = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
        'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
        "<hp:p><hp:run><hp:t>대관 계약서</hp:t></hp:run></hp:p>"
        "<hp:p><hp:run><hp:t>대관료 합계 5,500,000원 (VAT 포함)</hp:t></hp:run></hp:p>"
        "<hp:p><hp:run><hp:t>계약금 1,100,000원은 계약일에, 잔금은 행사 7일 전까지 지급</hp:t></hp:run></hp:p>"
        "<hp:p><hp:run><hp:t>A&amp;B 홀</hp:t><hp:tab/><hp:t>끝</hp:t></hp:run></hp:p>"
        "</hs:sec>"
    )
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/section0.xml", section)


quote_docx(os.path.join(OUT, "quote_v1.docx"), 3_300_000)
quote_docx(os.path.join(OUT, "quote_v2.docx"), 3_850_000)
minutes_docx(os.path.join(OUT, "minutes.docx"))
plan_xlsx(os.path.join(OUT, "catering.xlsx"))
hwpx(os.path.join(OUT, "rental.hwpx"))
with open(os.path.join(OUT, "fake.pdf"), "wb") as f:
    f.write(b"%PDF-1.4\n% test only\n")
print("fixtures written to", OUT)
