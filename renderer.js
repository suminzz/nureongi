// 화면: 강아지 그림, 말풍선, 클릭·드래그 처리.
const dog = document.getElementById("sprite");
const zzz = document.getElementById("zzz");
const hearts = document.getElementById("hearts");
const bubble = document.getElementById("bubble");
const textEl = document.getElementById("text");
const input = document.getElementById("input");

const SCALE = 0.4; // 시트 그림을 화면에 줄여서 보여 주는 비율
const center = () => window.innerWidth / 2; // 창의 가로 중심
const shadow = document.getElementById("shadow");
let big = 1; // 강아지 크기 배율 (쓰다듬기를 많이 하면 잠깐 커진다)
// 본체가 알려 주는 상태 → 보여 줄 그림
const POSE = { idle: "wag", walk: "run", sit: "sit", sleep: "sleep", drag: "surprise",
  eat: "eat", coffee: "coffee", study: "study", happy: "happy", pet: "pet", paw: "paw", leap: "leap", fly: "fly", tired: "tired" };

let sprites = null;
let current = { state: "idle", dir: -1 };
let override = null; // 잠깐 다른 동작을 보여 줄 때 (신남, 공부하기)
let overrideTimer = null;
let frameTimer = null;
let chatOpen = false;
let waiting = false;
let hideTimer = null;

// ---------- 그림 바꾸기 ----------

function render() {
  if (!sprites) return;
  const pose = current.state === "drag" ? "surprise" : override || POSE[current.state] || "wag";
  const s = sprites[pose];
  const key = pose + (current.fast ? "!" : ""); // 전력 질주할 때는 같은 그림을 더 빨리 넘긴다
  if (dog.dataset.pose !== key) {
    const scale = SCALE * (s.k || 1) * big;
    dog.dataset.pose = key;
    dog.className = `hit ${pose}${s.frames ? " frames" : ""}`;
    dog.style.width = `${s.w * scale}px`;
    dog.style.left = `${center() - s.cx * scale}px`;
    dog.style.bottom = `${-s.foot * scale}px`;
    dog.style.transformOrigin = `${s.cx * scale}px 100%`;
    zzz.classList.toggle("on", pose === "sleep");
    zzz.style.left = `${center() + 28 * big}px`;
    zzz.style.bottom = `${s.h * scale - 4}px`;
    hearts.classList.toggle("on", pose === "pet");
    hearts.style.bottom = `${s.h * scale - 2}px`;
    // 장면이 여러 장인 동작은 차례로 넘겨 보여 준다
    clearInterval(frameTimer);
    if (s.frames) {
      let i = 0;
      dog.src = `sprites/${s.frames[0]}`;
      frameTimer = setInterval(() => {
        i = (i + 1) % s.frames.length;
        dog.src = `sprites/${s.frames[i]}`;
      }, (s.ms || 120) * (current.fast ? 0.55 : 1));
    } else {
      dog.src = `sprites/${pose}.png`;
    }
  }
  // 그림은 왼쪽을 보고 있으므로, 오른쪽으로 달릴 때만 뒤집는다
  dog.style.setProperty("--flip", pose === "run" && current.dir > 0 ? -1 : 1);
}

// 신나는 동작을 보여 줄 시간: 폴짝 뛰기 두 번
function happyMs() {
  const s = sprites && sprites.happy;
  return s && s.frames ? s.frames.length * (s.ms || 120) * 2 : 1800;
}

// 크기가 바뀌면 그림자와 말풍선 자리도 맞추고 그림을 다시 놓는다
function resize() {
  shadow.style.width = `${96 * big}px`;
  shadow.style.height = `${9 * big}px`;
  shadow.style.marginLeft = `${-48 * big}px`;
  bubble.style.bottom = `${116 * big + 46}px`;
  hearts.style.fontSize = `${15 * Math.sqrt(big)}px`;
  dog.dataset.pose = "";
  render();
}
window.pet.onSize(({ k }) => {
  big = k;
  resize();
});
window.addEventListener("resize", resize); // 창 크기가 실제로 바뀐 뒤에 한 번 더 맞춘다

function showPose(pose, ms) {
  clearTimeout(overrideTimer);
  override = pose;
  render();
  if (ms) overrideTimer = setTimeout(() => showPose(null), ms);
}

window.pet.sprites().then((m) => {
  sprites = m;
  // 장면 그림을 미리 읽어 두어 넘길 때 깜빡이지 않게 한다
  for (const s of Object.values(m)) for (const f of s.frames || []) new Image().src = `sprites/${f}`;
  render();
});
window.pet.onState((s) => {
  current = s;
  if (s.act) showPose(null); // 시킨 동작은 다른 동작보다 먼저 보여 준다
  else render();
});

function updateBusy() {
  window.pet.busy(chatOpen || !bubble.classList.contains("hidden"));
}

function showBubble(text, { thinking = false } = {}) {
  clearTimeout(hideTimer);
  textEl.textContent = text;
  textEl.classList.toggle("thinking", thinking);
  bubble.classList.remove("hidden");
  updateBusy();
}

function hideBubble() {
  bubble.classList.add("hidden");
  updateBusy();
}

function hideLater(text) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, 4500 + text.length * 90);
}

window.pet.onSay(({ text, pose }) => {
  showBubble(text);
  if (!chatOpen) {
    // 말을 걸 때는 신나서 폴짝. 알림에 어울리는 동작이 있으면 그 동작을 조금 더 오래 보여 준다
    showPose(pose || "happy", pose && pose !== "happy" ? 5000 : happyMs());
    hideLater(text);
  }
});

// ---------- 대화 ----------

// 대화창을 열어 두고 잊어버려도 20초 뒤에는 닫혀서 강아지가 다시 돌아다닌다
let idleTimer = null;
function touchChat() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (chatOpen && !waiting && !input.value) closeChat();
    else if (chatOpen) touchChat();
  }, 20000);
}

function openChat() {
  chatOpen = true;
  touchChat();
  input.classList.remove("hidden");
  input.placeholder = "말을 걸어 보세요 (Esc로 닫기)";
  if (bubble.classList.contains("hidden") || !textEl.textContent) showBubble("부르셨어요? 멍!");
  else showBubble(textEl.textContent);
  window.pet.focus();
  setTimeout(() => input.focus(), 50);
}

function closeChat() {
  chatOpen = false;
  clearTimeout(idleTimer);
  input.classList.add("hidden");
  input.value = "";
  if (waiting) updateBusy();
  else hideBubble();
}

window.pet.onOpenChat(openChat);
window.pet.onCloseChat(closeChat);

input.addEventListener("keydown", async (e) => {
  touchChat();
  if (e.isComposing) return; // 한글 조합 중에는 Enter를 무시
  if (e.key === "Escape") return closeChat();
  if (e.key !== "Enter" || waiting) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  waiting = true;
  showBubble("", { thinking: true });
  showPose("study"); // 대답을 생각하는 동안은 책을 본다
  const reply = await window.pet.chat(text);
  waiting = false;
  showPose("happy", happyMs());
  showBubble(reply);
  if (!chatOpen) hideLater(reply);
});

window.addEventListener("blur", () => {
  if (chatOpen && !input.value) closeChat();
});

// ---------- 마우스: 강아지와 말풍선만 클릭되고, 나머지는 뒤 화면으로 통과 ----------

let overHit = false;
function setHit(v) {
  if (v === overHit) return;
  overHit = v;
  window.pet.ignoreMouse(!v);
}

let down = null;
let dragging = false;

window.addEventListener("mousemove", (e) => {
  if (down && !dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 5) {
    dragging = true;
    window.pet.dragStart();
  }
  if (dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setHit(!!(el && el.closest(".hit:not(.hidden)")));
});
document.addEventListener("mouseleave", () => {
  if (!dragging) setHit(false);
});

dog.addEventListener("mousedown", (e) => {
  if (e.button === 0) down = { x: e.screenX, y: e.screenY };
});
let clickTimer = null;
window.addEventListener("mouseup", () => {
  if (!down) return;
  if (dragging) window.pet.dragEnd();
  else if (clickTimer) {
    // 두 번째 클릭: 동작 고르기 메뉴
    clearTimeout(clickTimer);
    clickTimer = null;
    window.pet.actionMenu();
  } else {
    // 한 번 클릭: 더블클릭이 아닌지 잠깐 기다렸다가 대화창을 연다
    clickTimer = setTimeout(() => {
      clickTimer = null;
      chatOpen ? closeChat() : openChat();
    }, 280);
  }
  down = null;
  dragging = false;
});
dog.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.pet.menu();
});
