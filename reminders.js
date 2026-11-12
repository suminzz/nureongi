// 알림 시간표: 지금 어떤 알림을 할 때인지 판단한다.
// 설정 파일의 "reminders"에서 시간을 바꿀 수 있다.
const DEFAULTS = {
  lunch: "11:19", // 점심 알림 시각. 빈 문자열이면 끔
  leave: "16:59", // 퇴근 알림 시각. 빈 문자열이면 끔
  hourlyMorning: true, // 오전 매 정각에 시간 알려 주기
  careMinutes: 30, // 챙김 알림(허리 펴기·영양제·쉬기·스트레칭 등 중 하나) 간격(분). 0이면 끔
};

function createScheduler(startedAt = new Date()) {
  const st = { lunchDay: null, leaveDay: null, hourKey: null, lastCare: startedAt.getTime() };

  // 지금 해야 할 알림 종류를 돌려준다: "lunch" | "leave" | "hour" | "care" | null
  function due(now, cfg) {
    const day = now.toDateString();
    const mins = now.getHours() * 60 + now.getMinutes();

    // 정해진 시각부터 10분 안에, 하루 한 번
    for (const kind of ["lunch", "leave"]) {
      if (!cfg[kind]) continue;
      const [h, m] = cfg[kind].split(":").map(Number);
      const at = h * 60 + (m || 0);
      if (mins >= at && mins < at + 10 && st[`${kind}Day`] !== day) return kind;
    }
    if (cfg.hourlyMorning && now.getHours() < 12 && now.getMinutes() < 5 && st.hourKey !== `${day} ${now.getHours()}`) {
      return "hour";
    }
    if (cfg.careMinutes > 0 && now.getTime() - st.lastCare >= cfg.careMinutes * 60_000) return "care";
    return null;
  }

  // 알림을 했다고 기록한다.
  function done(kind, now, cfg) {
    if (kind === "lunch") st.lunchDay = now.toDateString();
    if (kind === "leave") st.leaveDay = now.toDateString();
    if (kind === "hour") st.hourKey = `${now.toDateString()} ${now.getHours()}`;
    if (kind === "care") st.lastCare = now.getTime();
    // 다른 알림 바로 뒤에 챙김 알림이 겹치지 않게 10분은 띄운다
    else if (cfg.careMinutes > 10) st.lastCare = Math.max(st.lastCare, now.getTime() - (cfg.careMinutes - 10) * 60_000);
  }

  return { due, done };
}

module.exports = { DEFAULTS, createScheduler };
