/**
 * 처리 기록. 스크립트 속성(PropertiesService)에 저장한다.
 *  f:<파일ID> / m:<메일ID> → { v: 처리한 버전, s: 추출 결과 서명, t: [할 일 ID], at }
 *  e:<키>                → { v: 실패한 버전, n: 실패 횟수, at }
 *  cursor:drive / cursor:gmail → 마지막으로 훑은 시각(ISO)
 */

const STATE_KEEP_DAYS = 180;

function props_() {
  return PropertiesService.getScriptProperties();
}

function loadState_(key) {
  const raw = props_().getProperty(key);
  return raw ? JSON.parse(raw) : null;
}

function saveState_(key, obj) {
  if (DRY_RUN) return;
  obj.at = Date.now();
  props_().setProperty(key, JSON.stringify(obj));
}

function deleteState_(key) {
  if (DRY_RUN) return;
  props_().deleteProperty(key);
}

function getCursor_(name) {
  return (
    props_().getProperty('cursor:' + name) ||
    new Date(Date.now() - CONFIG.FIRST_RUN_LOOKBACK_DAYS * 86400000).toISOString()
  );
}

function setCursor_(name, iso) {
  if (DRY_RUN) return;
  props_().setProperty('cursor:' + name, iso);
}

/** 오래된 처리 기록을 지워 저장 한도(500KB)를 넘지 않게 한다 */
function pruneState_() {
  if (DRY_RUN) return;
  const all = props_().getProperties();
  const limit = Date.now() - STATE_KEEP_DAYS * 86400000;
  Object.keys(all).forEach((key) => {
    if (!/^[fme]:/.test(key)) return;
    try {
      if (JSON.parse(all[key]).at < limit) props_().deleteProperty(key);
    } catch (e) {
      props_().deleteProperty(key);
    }
  });
}

function hash_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}
