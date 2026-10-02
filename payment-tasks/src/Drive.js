/**
 * 공유 드라이브 변경분 수집과 파일 읽기.
 * 내가 멤버인 공유 드라이브만 볼 수 있다(관리자 권한으로 다른 드라이브 파일을 여는 기능은 쓰지 않는다).
 */

function listSharedDrives_() {
  const drives = [];
  let pageToken;
  do {
    const res = Drive.Drives.list({ pageSize: 100, pageToken: pageToken });
    (res.drives || []).forEach((d) => drives.push({ id: d.id, name: d.name }));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return drives;
}

/** sinceIso 이후 새로 올라오거나 수정된 파일들 (수정 시각 오름차순) */
function listChangedSharedDriveFiles_(sinceIso) {
  const files = [];
  listSharedDrives_().forEach((drive) => {
    let pageToken;
    do {
      const res = Drive.Files.list({
        q:
          "modifiedTime >= '" + sinceIso + "' and trashed = false" +
          " and mimeType != 'application/vnd.google-apps.folder'" +
          " and mimeType != 'application/vnd.google-apps.shortcut'",
        corpora: 'drive',
        driveId: drive.id,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 200,
        pageToken: pageToken,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,lastModifyingUser(displayName,emailAddress))',
      });
      (res.files || []).forEach((f) => {
        f.driveName = drive.name;
        files.push(f);
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });
  return files.sort((a, b) => (a.modifiedTime < b.modifiedTime ? -1 : a.modifiedTime > b.modifiedTime ? 1 : 0));
}

/**
 * 파일 하나를 분석 대상(source)으로 만든다. 비용 문서 후보가 아니면 null.
 * 이름에 키워드가 없는 PDF·이미지·기타 형식은 내려받지 않는다.
 */
function buildDriveSource_(file) {
  const nameHit = matchesNameKeywords_(file.name);
  if (!nameHit && !isTextCheckable_(file.name, file.mimeType)) return null;

  const read = readDriveFile_(file);
  if (!nameHit && !(read.kind === 'text' && looksLikeCostContent_(read.text))) return null;

  const who = file.lastModifyingUser ? file.lastModifyingUser.displayName || file.lastModifyingUser.emailAddress : '알 수 없음';
  return {
    title: file.name,
    link: file.webViewLink,
    refDate: file.modifiedTime,
    meta: ['공유 드라이브: ' + file.driveName, '올린·수정한 사람: ' + who, '수정 시각: ' + toKst_(file.modifiedTime)],
    parts: [{ label: '파일: ' + file.name, read: read }],
  };
}

function readDriveFile_(file) {
  const base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id);
  if (file.mimeType === MIME.GDOC || file.mimeType === MIME.GSLIDES) {
    return { kind: 'text', text: driveFetch_(base + '/export?mimeType=text/plain').getDataAsString('UTF-8') };
  }
  if (file.mimeType === MIME.GSHEET) {
    return readBlob_(driveFetch_(base + '/export?mimeType=' + encodeURIComponent(MIME.XLSX)), file.name + '.xlsx', MIME.XLSX);
  }
  if (String(file.mimeType).indexOf('application/vnd.google-apps.') === 0) {
    return { kind: 'unreadable', reason: '자동으로 읽을 수 없는 Google 문서 형식입니다(' + file.mimeType + ').' };
  }
  if (Number(file.size || 0) > CONFIG.MAX_FILE_BYTES) {
    return { kind: 'unreadable', reason: '파일이 너무 큽니다(' + mb_(Number(file.size)) + ').' };
  }
  return readBlob_(driveFetch_(base + '?alt=media&supportsAllDrives=true'), file.name, file.mimeType);
}

function driveFetch_(url) {
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Drive 읽기 실패 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  return res.getBlob();
}

function toKst_(iso) {
  return Utilities.formatDate(new Date(iso), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}
