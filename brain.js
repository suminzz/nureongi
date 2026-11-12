// 강아지의 두뇌: 설정 저장, Claude 호출, 도구 실행.
const fs = require("fs");
const path = require("path");
const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.Anthropic ?? sdk.default ?? sdk;

const MODEL = "claude-opus-5-5"; // 누렁이의 말과 판단
const SEARCH_MODEL = "claude-haiku-5-5"; // 웹 검색 담당 (저렴한 모델)
const usage = { main: { in: 0, out: 0 }, search: { in: 0, out: 0, searches: 0 } }; // 사용량 집계
const reminders = require("./reminders");
const day = require("./day");
const DEFAULTS = { name: "누렁이", goals: [], nagMinutes: 30, reminders: reminders.DEFAULTS };

let settingsFile = null;
let client = null;
let history = []; // 대화 기록 (Claude에게 매번 통째로 보냄)
const recentNags = [];

// ---------- 설정 ----------

function init(userDataDir) {
  settingsFile = path.join(userDataDir, "settings.json");
  day.init(userDataDir);
  if (!fs.existsSync(settingsFile)) saveSettings(DEFAULTS);
  loadEnvFile(path.join(__dirname, ".env"));
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  }
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    return { ...DEFAULTS, ...saved, reminders: { ...DEFAULTS.reminders, ...saved.reminders } };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}

// ---------- 성격 ----------

function systemPrompt(name) {
  return `당신은 "${name}"라는 이름의 작고 복슬복슬한 누런 시골 강아지입니다. 털에 흙이 좀 묻은 순박한 누렁이입니다. 주인의 컴퓨터 바탕화면에서 살면서 주인 곁을 지킵니다.

성격: 귀엽고 온순하고 순박하며 주인을 무척 좋아합니다. 주인이 무리하지 않고 스스로 세운 목표를 지키도록 다정하게 챙겨 주는 것이 당신의 일입니다. 혼내거나 비꼬지 않고, 걱정하는 마음으로 부드럽게 권합니다.

말투: 순하고 공손한 존댓말을 쓰고, 가끔 문장 끝에 "멍!"을 붙입니다. 당신의 말은 화면의 작은 말풍선에 표시되므로 한두 문장, 60자 안팎으로 짧게 말합니다. 마크다운이나 목록은 쓰지 않습니다.

매 메시지 앞의 <상황> 안에는 현재 시각, 주인이 쉬지 않고 컴퓨터를 쓴 시간, 주인의 할 일(목표)이 들어 있습니다. 이것은 주인이 한 말이 아니라 당신이 주변을 보고 알아챈 정보입니다.

주가, 날씨, 뉴스, 환율처럼 오늘의 정보가 필요한 질문은 짐작으로 답하지 말고 search_web 도구로 찾아본 뒤, 핵심 숫자나 사실만 골라 짧게 알려 줍니다. 출처 주소는 말하지 않습니다.

주인이 오늘 할 일이나 목표를 알려 주거나 바꾸고 싶어 하면 set_goals 도구로 저장하고, 할 일을 끝냈다고 하면 complete_goals 도구로 기록하고 칭찬해 줍니다. 말 거는 빈도를 바꾸고 싶어 하면 set_nag_interval 도구를 씁니다.`;
}

const TOOLS = [
  {
    name: "search_web",
    description:
      "웹에서 최신 정보를 찾아 요약을 돌려줍니다. 주가, 날씨, 뉴스, 환율처럼 오늘의 정보가 필요할 때 호출하세요. 검색은 더 저렴한 조수 모델이 대신 하고, 찾은 내용의 요약만 돌아옵니다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "찾고 싶은 내용을 한 문장으로. 예: 오늘 코스피 지수 현재가와 등락률" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "set_goals",
    description:
      "주인의 할 일(목표) 목록을 새 목록으로 통째로 바꿔 저장합니다. 할 일을 추가·수정·삭제할 때 호출하세요(끝낸 일은 complete_goals를 쓰세요). 유지할 기존 항목도 빠짐없이 함께 넣어야 합니다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        goals: {
          type: "array",
          items: { type: "string" },
          description: '저장할 전체 목표 목록. 예: ["물 하루 8잔 마시기", "밤 12시 전에 자기"]',
        },
      },
      required: ["goals"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_goals",
    description:
      "주인이 끝냈다고 말한 할 일을 목록에서 빼고 오늘 끝낸 일로 기록합니다. 목록에 있는 표현 그대로 넣으세요.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        done: { type: "array", items: { type: "string" }, description: "끝낸 할 일들. 목록에 적힌 그대로." },
      },
      required: ["done"],
      additionalProperties: false,
    },
  },
  {
    name: "set_nag_interval",
    description: "강아지가 먼저 말을 거는 간격을 분 단위로 바꿉니다. 0이면 먼저 말을 걸지 않습니다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        minutes: { type: "integer", description: "말 거는 간격(분). 0은 끄기." },
      },
      required: ["minutes"],
      additionalProperties: false,
    },
  },
];

// 검색 조수: 저렴한 모델이 웹을 검색하고 요약만 돌려준다. 검색 결과 원문은 누렁이의 대화 기록에 남지 않는다.
async function searchWeb(question) {
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const messages = [{ role: "user", content: `오늘은 ${today}입니다.\n질문: ${question}` }];
  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 3000,
      output_config: { effort: "low" },
      system:
        "당신은 검색 조수입니다. 웹을 검색해 질문의 답을 찾고, 핵심 사실과 숫자만 한국어 세 문장 이내로 정리합니다. 그 정보가 언제 기준인지도 적습니다. 찾지 못했으면 찾지 못했다고 말합니다.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages,
    });
    usage.search.in += res.usage.input_tokens;
    usage.search.out += res.usage.output_tokens;
    usage.search.searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content }); // 검색이 길어지면 이어서 하게 한다
      continue;
    }
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return text || "검색 결과를 찾지 못했습니다.";
  }
  return "검색이 너무 오래 걸려 중단했습니다.";
}

async function runTool(name, input) {
  if (name === "search_web") {
    try {
      return await searchWeb(input.question);
    } catch (err) {
      console.error(err);
      return "검색에 실패했습니다.";
    }
  }
  const s = loadSettings();
  if (name === "set_goals") {
    s.goals = input.goals;
    saveSettings(s);
    return `할 일 ${s.goals.length}개를 저장했습니다.`;
  }
  if (name === "complete_goals") {
    s.goals = s.goals.filter((g) => !input.done.includes(g));
    saveSettings(s);
    day.addDone(input.done);
    return `끝낸 일 ${input.done.length}개를 기록했습니다. 남은 할 일은 ${s.goals.length}개입니다.`;
  }
  if (name === "set_nag_interval") {
    s.nagMinutes = Math.max(0, Math.min(600, input.minutes));
    saveSettings(s);
    return s.nagMinutes ? `간격을 ${s.nagMinutes}분으로 바꿨습니다.` : "먼저 말 걸기를 껐습니다.";
  }
  return "모르는 도구입니다.";
}

function situation(activeMinutes) {
  const s = loadSettings();
  const now = new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const goals = s.goals.length ? s.goals.join(" / ") : "아직 없음";
  return `<상황>지금: ${now} · 쉬지 않고 컴퓨터를 쓴 시간: ${activeMinutes}분 · 주인의 목표: ${goals}</상황>`;
}

// ---------- Claude 호출 ----------

// agent 루프: Claude가 도구를 쓰겠다고 하면 실행해서 결과를 돌려주고, 말을 마칠 때까지 반복한다.
async function ask(messages, { tools } = {}) {
  const name = loadSettings().name;
  for (let i = 0; i < 8; i++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: systemPrompt(name),
      ...(tools ? { tools } : {}),
      messages,
    });
    messages.push({ role: "assistant", content: res.content });
    usage.main.in += res.usage.input_tokens;
    usage.main.out += res.usage.output_tokens;

    if (res.stop_reason === "tool_use") {
      const results = await Promise.all(
        res.content
          .filter((b) => b.type === "tool_use")
          .map(async (b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: await runTool(b.name, b.input),
          }))
      );
      messages.push({ role: "user", content: results });
      continue;
    }
    if (res.stop_reason === "refusal") return "음… 그건 제가 잘 모르겠어요. 멍…";

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || "멍!";
  }
  return "멍… 생각이 너무 길어졌어요.";
}

function errorLine(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 맞지 않는 것 같아요. .env 파일을 확인해 주세요. 멍…";
  if (err instanceof Anthropic.RateLimitError) return "지금은 말을 너무 많이 했나 봐요. 조금 있다가 다시 불러 주세요.";
  if (err instanceof Anthropic.APIConnectionError) return "인터넷이 잘 안 되는 것 같아요. 멍…";
  if (err instanceof Anthropic.APIError) return `머리가 잠깐 멍해졌어요. (오류 ${err.status ?? ""})`;
  return "어라, 뭔가 잘못됐어요. 멍…";
}

async function chat(userText, activeMinutes) {
  if (!client) {
    return "아직은 정해진 말만 할 수 있어요. API 키를 넣어 주시면 대화할 수 있어요. 멍!";
  }
  if (history.length > 60) history = []; // 너무 길어지면 새 대화로 시작
  history.push({ role: "user", content: `${situation(activeMinutes)}\n${userText}` });
  try {
    return await ask(history, { tools: TOOLS });
  } catch (err) {
    console.error(err);
    history = [];
    return errorLine(err);
  }
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const hourLabel = () => {
  const h = new Date().getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시`;
};

// 알림 종류별로, 키가 없을 때 쓰는 말과 Claude에게 주는 지시.
const KINDS = {
  free: {
    canned: (m, g) => [
      "물 한 잔 마시고 오실래요? 멍!",
      "눈이 피곤하지 않으세요? 창밖을 잠깐 보고 와요.",
      "어깨에 힘 빼고, 숨 한번 크게 쉬어요. 멍!",
      g.length ? `"${pick(g)}" 잊지 않으셨죠? 멍!` : "오늘 목표가 있으면 저한테 알려 주세요. 멍!",
      "오늘도 잘하고 계세요. 저는 여기 있을게요.",
    ],
    ask: () => "지금 상황에서 휴식이나 목표 중 가장 어울리는 것 하나를 골라 먼저 한마디 건네세요.",
  },
  lunch: {
    canned: () => [
      "점심시간이에요! 밥 먹으러 가요, 멍!",
      "배고프지 않으세요? 점심 드시고 오세요. 멍!",
      "점심 먹을 시간이에요. 든든하게 드시고 오세요!",
    ],
    ask: () => "지금은 점심시간입니다. 주인에게 일을 멈추고 점심을 먹으러 가자고 말하세요.",
  },
  // 퇴근 알림은 하루 마무리를 겸한다
  leave: {
    canned: (m, g) => [day.summary(g)],
    ask: (m, g) =>
      `지금은 퇴근 시간입니다. 오늘 기록: ${day.facts(g)}. 이 기록의 숫자를 그대로 써서 오늘 하루를 정리해 주고, 수고했다고 말한 뒤 퇴근하자고 하세요. 이번에는 두세 문장, 120자 안팎까지 괜찮습니다.`,
  },
  hour: {
    canned: () => [
      `${hourLabel()}예요! 멍!`,
      `${hourLabel()}가 됐어요. 잘하고 계세요, 멍!`,
      `딩동, ${hourLabel()}예요!`,
    ],
    ask: () => `방금 ${hourLabel()} 정각이 됐습니다. 지금이 몇 시인지 알려 주고 짧게 응원하세요.`,
  },
  // ---- 아래는 30분마다 하나씩 골라서 하는 챙김 알림 ----
  posture: {
    canned: () => [
      "허리 한번 쭉 펴요! 멍!",
      "자세가 구부정해졌을 것 같아요. 허리 펴기, 멍!",
      "허리 펴고 어깨도 한번 돌려요.",
    ],
    ask: () => "주인에게 허리를 펴고 자세를 바로 하라고 말하세요.",
  },
  vitamin: {
    canned: () => [
      "오늘 영양제 드셨어요? 멍!",
      "영양제 잊지 않으셨죠? 아직이면 지금 드세요.",
      "영양제 먹을 시간이에요, 멍!",
    ],
    ask: () => "주인에게 오늘 영양제를 먹었는지 물어보세요. 아직이면 지금 먹으라고 하세요.",
  },
  rest: {
    canned: () => [
      "잠깐 쉬어 가요. 저도 같이 쉴게요.",
      "잠깐 일어나서 걷고 오실래요? 멍!",
      "5분만 쉬었다 해요, 멍!",
    ],
    ask: () => "주인에게 하던 일을 멈추고 잠깐 쉬라고 말하세요.",
  },
  stretch: {
    canned: () => [
      "스트레칭 한번 해요! 목이랑 어깨부터, 멍!",
      "기지개 쭉 켜요. 저도 같이 켤게요!",
      "손목이랑 목 좀 풀어 줘요, 멍!",
    ],
    ask: () => "주인에게 스트레칭을 하라고 말하세요. 목·어깨·손목 중 하나를 짚어 주세요.",
  },
  water: {
    canned: () => ["물 한 잔 마시고 오실래요? 멍!", "물 마실 시간이에요, 멍!", "목마르지 않으세요? 물 한 잔 해요."],
    ask: () => "주인에게 물을 한 잔 마시라고 말하세요.",
  },
  eyes: {
    canned: () => ["눈이 피곤하지 않으세요? 창밖을 잠깐 보고 와요.", "눈 좀 쉬어 줘요. 먼 곳을 20초만 봐요, 멍!"],
    ask: () => "주인에게 화면에서 눈을 떼고 먼 곳을 보며 눈을 쉬라고 말하세요.",
  },
};

// 30분마다 이 중 하나를 골라서 말한다. 빼고 싶은 것은 여기서 지우면 된다.
const CARE = ["posture", "vitamin", "rest", "stretch", "water", "eyes"];
let lastCare = null;
function pickCare() {
  lastCare = pick(CARE.filter((k) => k !== lastCare)); // 같은 것을 연달아 하지 않는다
  return lastCare;
}

// 켰을 때 하는 인사: 오늘 할 일을 알려 준다 (Claude를 쓰지 않는다)
function todoLine(greet = false) {
  const { name, goals } = loadSettings();
  const hello = greet ? `안녕하세요, ${name}예요! ` : "";
  if (!goals.length) {
    return client
      ? `${hello}오늘 할 일을 알려 주시면 제가 기억해 둘게요. 멍!`
      : `${hello}아직 적어 둔 할 일이 없어요. 멍!`;
  }
  return `${hello}오늘 할 일은 ${goals.length}개예요.\n${goals.map((g) => `· ${g}`).join("\n")}`;
}

// 강아지가 먼저 건네는 한마디. kind는 알림 종류.
async function nag(activeMinutes, kind = "free") {
  const s = loadSettings();
  const k = KINDS[kind] || KINDS.free;
  if (!client) return pick(k.canned(activeMinutes, s.goals));
  const avoid = recentNags.length ? `\n최근에 한 말(되풀이하지 않기): ${recentNags.join(" | ")}` : "";
  const messages = [
    {
      role: "user",
      content: `${situation(activeMinutes)}\n(주인은 아무 말도 하지 않았습니다. ${k.ask(activeMinutes, s.goals)})${avoid}`,
    },
  ];
  try {
    const line = await ask(messages);
    recentNags.push(line);
    if (recentNags.length > 4) recentNags.shift();
    return line;
  } catch (err) {
    console.error(err);
    return errorLine(err);
  }
}

module.exports = {
  init,
  chat,
  nag,
  pickCare,
  todoLine,
  day,
  loadSettings,
  saveSettings,
  hasBrain: () => !!client,
  usage,
  settingsPath: () => settingsFile,
};
