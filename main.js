// 본체: 투명한 창을 띄우고, 강아지를 움직이고, 때가 되면 말을 걸게 한다.
const { app, BrowserWindow, ipcMain, screen, Menu, shell, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const brain = require("./brain");
const reminders = require("./reminders");

const WIN_W = 320;
const WIN_H = 380; // 폴짝 뛸 때 말풍선에 닿지 않게 여유를 둔다
const TICK = 33; // 약 30fps
const GRAVITY = 1.6; // 한 틱마다 떨어지는 속도가 늘어나는 양
const DOG_H = 120; // 창 바닥에서 강아지 머리 꼭대기까지의 높이
const SPEED = 2.2; // 한 틱에 달리는 픽셀 수

let win = null;
let area = null; // 강아지가 돌아다닐 수 있는 화면 영역
const pet = { x: 0, y: 0, dir: 1, state: "idle", timer: 2000, busy: false, drag: null, vy: 0 };

let activeMinutes = 0; // 쉬지 않고 컴퓨터를 쓴 시간
let lastNagAt = Date.now();
const schedule = reminders.createScheduler();
// 알림 종류마다 보여 줄 동작
const REMIND_POSE = { leave: "happy", lunch: "eat", hour: "happy", rest: "coffee", water: "coffee", vitamin: "eat" };

const groundY = () => area.y + area.height - WIN_H;
const minX = () => area.x;
const maxX = () => area.x + area.width - WIN_W;
const rand = (a, b) => a + Math.random() * (b - a);

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setState(state, ms) {
  pet.state = state;
  if (ms) pet.timer = ms;
  send("pet-state", { state: pet.state, dir: pet.dir, act: !!pet.act });
}

// 평소에는 달리다가 멈춰서 꼬리를 흔드는 것만 되풀이한다.
function pickNext() {
  if (pet.state === "walk") {
    setState("idle", rand(2500, 6000));
  } else {
    // 쉬고 나면 다시 달린다
    if (Math.random() < 0.4) pet.dir *= -1;
    setState("walk", rand(4000, 9000));
  }
}

// 주인이 시킨 동작 (더블클릭 메뉴). ms 동안 그 자리에서 보여 준 뒤 다시 돌아다닌다.
const ACTIONS = {
  eat: { label: "🍚 밥 주기", state: "eat", ms: 4320 },
  pet: { label: "🤚 쓰다듬기", state: "pet", ms: 4000 },
  sit: { label: "🐶 앉아", state: "sit", ms: 6000 },
  paw: { label: "🐾 손", state: "paw", ms: 3600 },
  jump: { label: "⭐ 점프", state: "leap", ms: 5000, leap: true }, // 화면 천장까지 뛰어오른다
  follow: { label: "🏃 따라와", state: "idle", ms: 7000, follow: true },
};

function doAction(name) {
  const a = ACTIONS[name];
  if (!a || pet.drag) return;
  pet.act = true;
  brain.day.bump("plays");
  pet.follow = !!a.follow;
  setState(a.state, a.ms);
  if (a.leap && pet.y >= groundY()) leapTo(area.y);
}

const actionItems = () => Object.entries(ACTIONS).map(([name, a]) => ({ label: a.label, click: () => doAction(name) }));

function showActionMenu() {
  Menu.buildFromTemplate(actionItems()).popup({ window: win });
}

// 머리가 화면의 top 높이에 닿도록 뛰어오른다. 내려오는 것은 tick의 떨어지기가 맡는다.
function leapTo(top) {
  const headY = groundY() + WIN_H - DOG_H;
  pet.vy = -Math.sqrt(2 * GRAVITY * Math.max(0, headY - top)) * 1.02; // 틱 단위 계산이라 조금 모자라서 보정
  pet.y -= 1;
  setState("leap");
}

// 따라갈 마우스 위치. 개발용으로 PUPPY_MOUSE="x,y"를 주면 그 자리에 마우스가 있는 것으로 친다.
const FAKE_MOUSE = process.env.PUPPY_MOUSE ? process.env.PUPPY_MOUSE.split(",").map(Number) : null;
const mousePoint = () => (FAKE_MOUSE ? { x: FAKE_MOUSE[0], y: FAKE_MOUSE[1] } : screen.getCursorScreenPoint());

// 따라오기: 마우스가 있는 쪽으로 바닥을 따라 달려간다. 가까이 오면 멈춰서 꼬리를 흔든다.
function followCursor() {
  const cursor = mousePoint();
  const dx = cursor.x - (pet.x + WIN_W / 2);
  // 마우스가 머리 위로 높이 있으면 그 높이까지(화면 맨 위까지) 뛰어오른다
  const headY = groundY() + WIN_H - DOG_H;
  if (Math.abs(dx) < 90 && cursor.y < headY - 60) {
    leapTo(Math.max(area.y, cursor.y - 20));
    return;
  }
  const far = Math.abs(dx) > (pet.state === "walk" ? 10 : 40); // 멈췄다 달렸다를 되풀이하지 않게 여유를 둔다
  if (!far) {
    if (pet.state !== "idle") setState("idle");
    return;
  }
  const dir = dx > 0 ? 1 : -1;
  if (pet.state !== "walk" || pet.dir !== dir) {
    pet.dir = dir;
    setState("walk");
  }
  const step = Math.min(Math.abs(dx), SPEED * 1.8); // 평소보다 빨리 달린다
  pet.x = Math.max(minX(), Math.min(maxX(), pet.x + dir * step));
}

function tick() {
  if (!win || win.isDestroyed()) return;

  if (pet.drag) {
    const c = screen.getCursorScreenPoint();
    pet.x = c.x - pet.drag.dx;
    pet.y = c.y - pet.drag.dy;
  } else if (pet.y < groundY()) {
    // 들어 올렸다 놓으면 바닥으로 떨어진다
    pet.vy += GRAVITY;
    pet.y = Math.min(groundY(), pet.y + pet.vy);
    if (pet.act) pet.timer -= TICK;
    if (pet.follow) {
      // 따라오다 뛰어오른 중: 공중에서도 마우스 쪽으로 움직인다
      const dx = mousePoint().x - (pet.x + WIN_W / 2);
      pet.x = Math.max(minX(), Math.min(maxX(), pet.x + Math.sign(dx) * Math.min(Math.abs(dx), SPEED * 1.8)));
    }
    if (pet.y >= groundY()) {
      pet.vy = 0;
      if (pet.follow && pet.timer > 0) setState("idle"); // 따라오기는 남은 시간 동안 계속한다
      else {
        pet.act = false;
        pet.follow = false;
        setState("idle", 1500);
      }
    }
  } else {
    pet.y = groundY();
    pet.x = Math.max(minX(), Math.min(maxX(), pet.x));
    if (pet.demo) {
      // 개발용 캡처 중: 스스로 움직이지 않는다
    } else if (pet.act) {
      // 시킨 동작을 하는 중: 끝나면 다시 평소대로
      pet.timer -= TICK;
      if (pet.follow) followCursor();
      if (pet.timer <= 0) {
        pet.act = false;
        pet.follow = false;
        setState("idle", 1200);
      }
    } else if (pet.busy) {
      if (pet.state !== "sit") setState("sit");
    } else {
      pet.timer -= TICK;
      if (pet.timer <= 0) pickNext();
      if (pet.state === "walk") {
        pet.x += pet.dir * SPEED;
        if (pet.x <= minX() || pet.x >= maxX()) {
          pet.x = Math.max(minX(), Math.min(maxX(), pet.x));
          pet.dir *= -1;
          setState("walk");
        }
      }
    }
  }
  win.setPosition(Math.round(pet.x), Math.round(pet.y));
}

function say(text, pose) {
  send("say", { text, pose });
}

// kind: "free"(자유로운 한마디) 또는 알림 종류
async function nagNow(kind = "free") {
  if (kind === "care") kind = brain.pickCare(); // 챙김 알림은 여러 가지 중 하나를 고른다
  lastNagAt = Date.now();
  say(await brain.nag(activeMinutes, kind), REMIND_POSE[kind]);
}

// 1분마다: 사용 시간을 재고, 알림이나 한마디를 할 때가 됐는지 확인한다.
function everyMinute() {
  const idle = powerMonitor.getSystemIdleTime(); // 마지막 입력 후 지난 초
  if (idle >= 300) {
    if (activeMinutes > 0) brain.day.bump("breaks"); // 일하다가 자리를 비웠다 = 한 번 쉬었다
    activeMinutes = 0;
  } else if (idle < 120) {
    activeMinutes += 1;
    brain.day.bump("workMinutes");
  }

  const s = brain.loadSettings();
  const now = new Date();
  const kind = schedule.due(now, s.reminders);
  if (pet.busy || idle >= 300) return; // 말하는 중이거나 자리에 없으면 다음 기회에

  if (kind) {
    schedule.done(kind, now, s.reminders);
    return nagNow(kind);
  }
  const due = s.nagMinutes > 0 && Date.now() - lastNagAt >= s.nagMinutes * 60_000;
  if (due && idle < 120) nagNow();
}

function showMenu() {
  const s = brain.loadSettings();
  const interval = (label, minutes) => ({
    label,
    type: "radio",
    checked: s.nagMinutes === minutes,
    click: () => brain.saveSettings({ ...brain.loadSettings(), nagMinutes: minutes }),
  });
  Menu.buildFromTemplate([
    { label: `${s.name}에게 말 걸기`, click: () => send("open-chat") },
    { label: "놀아 주기", submenu: actionItems() },
    { label: "오늘 할 일 보기", click: () => say(brain.todoLine()) },
    { label: "하루 마무리 듣기", click: () => nagNow("leave") },
    { label: "지금 한마디 해줘", click: () => nagNow() },
    {
      label: "알림 미리 보기",
      submenu: [
        { label: "점심시간", click: () => nagNow("lunch") },
        { label: "정각 알림", click: () => nagNow("hour") },
        { label: "챙김 알림 (아무거나)", click: () => nagNow("care") },
        { label: "허리 펴기", click: () => nagNow("posture") },
        { label: "영양제", click: () => nagNow("vitamin") },
        { label: "잠깐 쉬기", click: () => nagNow("rest") },
        { label: "스트레칭", click: () => nagNow("stretch") },
      ],
    },
    { type: "separator" },
    {
      label: "먼저 말 거는 간격",
      submenu: [interval("10분", 10), interval("30분", 30), interval("1시간", 60), interval("끄기", 0)],
    },
    { label: "설정 파일 열기 (이름·목표·알림 시간)", click: () => shell.openPath(brain.settingsPath()) },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]).popup({ window: win });
}

function createWindow() {
  area = screen.getPrimaryDisplay().workArea;
  pet.x = area.x + area.width * 0.6;
  pet.y = groundY();

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: Math.round(pet.x),
    y: Math.round(pet.y),
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    enableLargerThanScreen: true, // 높이 뛸 때 창이 화면 위쪽 밖으로 나갈 수 있게 한다
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true }); // 강아지가 아닌 곳은 클릭이 뒤로 통과
  win.loadFile(path.join(__dirname, "index.html"));

  win.webContents.once("did-finish-load", () => {
    win.showInactive();
    setState("idle", 2500);
    setInterval(tick, TICK);
    // 정각 알림이 제때 나오도록 분이 바뀌는 순간에 맞춰 확인한다
    setTimeout(() => {
      everyMinute();
      setInterval(everyMinute, 60_000);
    }, 61_000 - (Date.now() % 60_000));
    const { name } = brain.loadSettings();
    setTimeout(() => {
      say(brain.todoLine(true)); // 켜면 인사와 함께 오늘 할 일을 알려 준다
    }, 1200);
    if (process.env.PUPPY_SHOT) debugShots(process.env.PUPPY_SHOT);
    // 개발용: 시작 3초 뒤에 지정한 동작을 시킨다 (예: PUPPY_ACT=follow)
    if (process.env.PUPPY_ACT) setTimeout(() => doAction(process.env.PUPPY_ACT), 3000);
    if (process.env.PUPPY_LOG) {
      // 개발용: 2초마다 상태를 기록한다
      const tops = []; // 그동안 창이 실제로 올라간 가장 높은 위치를 보려고 모아 둔다
      setInterval(() => tops.push(win.getPosition()[1]), TICK);
      setInterval(() => {
        const [wx, wy] = win.getPosition();
        console.log(`top=${Math.min(...tops.splice(0))} mouse=${mousePoint().x} act=${!!pet.act} state=${pet.state} busy=${pet.busy} timer=${Math.round(pet.timer)} x=${Math.round(pet.x)} win=${wx},${wy} ground=${groundY()} visible=${win.isVisible()}`);
      }, 2000);
    }
  });

  screen.on("display-metrics-changed", () => {
    area = screen.getPrimaryDisplay().workArea;
  });
}

// 개발용: 창 모습을 이미지로 저장하고 종료한다.
async function debugShots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };
  await wait(2000);
  await shot("1-hello");
  await wait(6000);
  pet.demo = true;
  setState("idle");
  for (let i = 1; i <= 4; i++) {
    await wait(280);
    await shot(`2-idle-${i}`);
  }
  for (const st of ["sit", "eat", "coffee", "study", "sleep", "drag", "happy", "pet", "paw", "leap"]) {
    setState(st);
    await wait(st === "happy" ? 480 : 700); // 신남은 가장 높이 뛴 장면을 찍는다
    await shot(`2-${st}`);
  }
  pet.dir = 1;
  setState("walk");
  for (let i = 1; i <= 4; i++) {
    await wait(115);
    await shot(`3-run-right-${i}`);
  }
  pet.dir = -1;
  setState("walk");
  await wait(300);
  await shot("3-run-left");
  setState("sit");
  send("open-chat");
  await wait(800);
  await shot("4-chat");
  app.quit();
}

ipcMain.on("ignore-mouse", (_e, v) => win.setIgnoreMouseEvents(v, { forward: true }));
ipcMain.on("drag-start", () => {
  const c = screen.getCursorScreenPoint();
  pet.drag = { dx: c.x - pet.x, dy: c.y - pet.y };
  pet.act = false;
  setState("drag");
});
ipcMain.on("drag-end", () => {
  pet.drag = null;
  pet.vy = 0;
  if (pet.y >= groundY()) setState("idle", 1500);
});
ipcMain.on("focus", () => win.focus());
ipcMain.on("busy", (_e, v) => {
  pet.busy = v;
  if (!v) pet.timer = 600; // 말이 끝나면 곧 다시 움직인다
});
ipcMain.on("menu", showMenu);
ipcMain.on("action-menu", showActionMenu);
ipcMain.handle("sprites", () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "sprites", "sprites.json"), "utf8"))
);
ipcMain.handle("chat", (_e, text) => {
  lastNagAt = Date.now(); // 방금 대화했으면 잔소리는 잠시 미룬다
  return brain.chat(String(text).slice(0, 2000), activeMinutes);
});

app.whenReady().then(() => {
  brain.init(app.getPath("userData"));
  createWindow();
});
app.on("window-all-closed", () => app.quit());
