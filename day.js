// 오늘 하루 기록: 일한 시간, 쉰 횟수, 끝낸 일 등을 모아 두었다가 하루 마무리 때 쓴다.
// 날짜가 바뀌면 새로 시작한다. 앱을 껐다 켜도 그날 기록은 이어진다.
const fs = require("fs");
const path = require("path");

let file = null;
let d = null;

const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`;
};
const fresh = () => ({ date: today(), workMinutes: 0, breaks: 0, cares: 0, plays: 0, chats: 0, done: [] });

function init(userDataDir) {
  file = path.join(userDataDir, "today.json");
}

function get() {
  if (!d) {
    try {
      d = { ...fresh(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      d = fresh();
    }
  }
  if (d.date !== today()) d = fresh();
  return d;
}

function save() {
  if (file) fs.writeFileSync(file, JSON.stringify(d, null, 2));
}

function bump(key, n = 1) {
  get()[key] += n;
  save();
}

function addDone(items) {
  get().done.push(...items);
  save();
}

const workLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`);

// Claude에게 건넬 오늘 기록 (사실만)
function facts(goals) {
  const t = get();
  return [
    `컴퓨터로 일한 시간 ${workLabel(t.workMinutes)}`,
    `자리를 비우고 쉰 횟수 ${t.breaks}번`,
    `끝낸 할 일 ${t.done.length}개${t.done.length ? `(${t.done.join(", ")})` : ""}`,
    `남은 할 일 ${goals.length}개${goals.length ? `(${goals.join(", ")})` : ""}`,
    `강아지와 놀아 준 횟수 ${t.plays}번`,
  ].join(" · ");
}

// Claude 없이 말할 때 쓰는 하루 마무리
function summary(goals) {
  const t = get();
  const parts = [`오늘 ${workLabel(t.workMinutes)} 일하고 ${t.breaks}번 쉬셨어요.`];
  if (t.done.length) parts.push(`끝낸 일은 ${t.done.length}개예요!`);
  if (goals.length) parts.push(`남은 일 ${goals.length}개는 내일 해요.`);
  parts.push("고생 많으셨어요. 이제 퇴근해요, 멍!");
  return parts.join(" ");
}

module.exports = { init, get, bump, addDone, facts, summary };
