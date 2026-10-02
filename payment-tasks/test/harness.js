// Apps Script 코드를 Node에서 돌리기 위한 가짜 Google 서비스.
// src/*.js 를 한 스크립트로 이어 붙여 vm 안에서 실행한다(Apps Script와 같은 전역 공유 방식).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const FIX = path.join(__dirname, 'fixtures');

class FakeBlob {
  constructor(buf, name, type) {
    this.buf = Buffer.from(buf);
    this.name = name || '';
    this.type = type || 'application/octet-stream';
  }
  getBytes() { return Array.from(this.buf); }
  getDataAsString() { return this.buf.toString('utf8'); }
  copyBlob() { return new FakeBlob(this.buf, this.name, this.type); }
  setContentType(t) { this.type = t; return this; }
  getName() { return this.name; }
  getContentType() { return this.type; }
}

function unzip(blob) {
  const out = execFileSync('python3', ['-c', [
    'import sys, zipfile, io, json, base64',
    'z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))',
    'print(json.dumps({n: base64.b64encode(z.read(n)).decode() for n in z.namelist()}))',
  ].join('\n')], { input: blob.buf, maxBuffer: 64 * 1024 * 1024 });
  const map = JSON.parse(out.toString());
  return Object.keys(map).map((n) => new FakeBlob(Buffer.from(map[n], 'base64'), n));
}

function fixture(name) {
  return fs.readFileSync(path.join(FIX, name));
}

function createEnv(opts = {}) {
  const props = {};
  const tasks = {}; // id -> task
  const taskLists = [];
  const claudeRequests = [];
  const sleeps = [];
  let taskSeq = 0;
  const env = {
    driveFiles: [], // {id,name,mimeType,size,modifiedTime,webViewLink,lastModifyingUser, content: Buffer}
    mails: [], // {id, threadId, subject, from, date, body, attachments:[{name,type,content}]}
    claudeResponder: null, // (body) => {code, json}
    props, tasks, taskLists, claudeRequests, sleeps,
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => Object.assign({}, props),
    }),
  };

  const Drive = {
    Drives: { list: () => ({ drives: [{ id: 'd1', name: '경영지원' }] }) },
    Files: {
      list: (p) => {
        const since = /modifiedTime >= '([^']+)'/.exec(p.q)[1];
        if (p.driveId !== 'd1' || p.corpora !== 'drive' || !p.supportsAllDrives) throw new Error('bad list params');
        return { files: env.driveFiles.filter((f) => f.modifiedTime >= since).map((f) => Object.assign({}, f, { content: undefined })) };
      },
    },
  };

  const Tasks = {
    Tasklists: {
      list: () => ({ items: taskLists.slice() }),
      insert: (l) => { const nl = { id: 'L' + (taskLists.length + 1), title: l.title }; taskLists.push(nl); return nl; },
    },
    Tasks: {
      insert: (t, listId) => { const id = 'T' + ++taskSeq; tasks[id] = Object.assign({ id, listId, status: 'needsAction' }, t); return tasks[id]; },
      get: (listId, id) => { if (!tasks[id]) throw new Error('not found'); return tasks[id]; },
      remove: (listId, id) => { delete tasks[id]; },
    },
  };

  const UrlFetchApp = {
    fetch: (url, o) => {
      if (url.indexOf('https://www.googleapis.com/drive/v3/files/') === 0) {
        const id = decodeURIComponent(/files\/([^/?]+)/.exec(url)[1]);
        const f = env.driveFiles.find((x) => x.id === id);
        env.downloads = (env.downloads || []).concat(id);
        return response(200, f.content, f.name);
      }
      if (url === 'https://api.anthropic.com/v1/messages') {
        const body = JSON.parse(o.payload);
        claudeRequests.push({ headers: o.headers, body });
        const r = env.claudeResponder(body);
        return response(r.code, Buffer.from(JSON.stringify(r.json)));
      }
      throw new Error('unexpected url ' + url);
    },
  };
  function response(code, buf, name) {
    return {
      getResponseCode: () => code,
      getContentText: () => buf.toString('utf8'),
      getBlob: () => new FakeBlob(buf, name),
    };
  }

  const Utilities = {
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    computeDigest: (alg, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: (ms) => sleeps.push(ms),
    unzip,
    formatDate: (d, tz, fmt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(d).map((x) => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
    },
  };

  const GmailApp = {
    search: (q, start, max) => {
      const since = Number(/after:(\d+)/.exec(q)[1]) * 1000;
      const msgs = env.mails.filter((m) => m.date.getTime() >= since).slice(start, start + max);
      return msgs.map((m) => ({ getMessages: () => [fakeMessage(m)] }));
    },
  };
  function fakeMessage(m) {
    return {
      getId: () => m.id,
      getSubject: () => m.subject,
      getFrom: () => m.from,
      getDate: () => m.date,
      isInTrash: () => false,
      getPlainBody: () => m.body,
      getThread: () => ({ getId: () => m.threadId }),
      getAttachments: () => (m.attachments || []).map((a) => new FakeBlob(a.content, a.name, a.type)),
    };
  }

  const context = {
    console: opts.quiet === false ? console : { log() {}, error() {} },
    PropertiesService, Drive, Tasks, UrlFetchApp, Utilities, GmailApp,
    ScriptApp: { getOAuthToken: () => 'token', getProjectTriggers: () => [], newTrigger: () => ({}) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    Date, JSON, Math, Number, String, Object, Array, Buffer, Intl,
  };
  vm.createContext(context);
  const files = ['Config.js', 'Extract.js', 'Rules.js', 'Claude.js', 'Tasks.js', 'State.js', 'Drive.js', 'Gmail.js', 'Main.js'];
  const code = files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n') +
    '\n;globalThis.__get = (name) => eval(name);';
  vm.runInContext(code, context, { filename: 'apps-script-bundle.js' });
  env.get = context.__get;
  env.FakeBlob = FakeBlob;
  return env;
}

module.exports = { createEnv, fixture, FakeBlob };
