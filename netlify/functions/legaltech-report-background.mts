import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

function getWeekRange(): { start: string; end: string; label: string } {
  const now = new Date();
  // 뉴스 수집 기준: 미국 동부 표준시 EST (UTC-5)
  const est = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const day = est.getUTCDay(); // 0=일, 1=월, ..., 6=토

  // 직전 주 토요일(종료일): 일요일(day=0)이면 1일 전, 월요일(day=1)이면 2일 전, ...
  // 트리거가 월요일 00:00 UTC = EST 일요일 19:00에 실행되므로 day=0이 정상
  const daysBackToSaturday = day === 6 ? 0 : day + 1;
  const prevSaturday = new Date(est);
  prevSaturday.setUTCDate(est.getUTCDate() - daysBackToSaturday);

  // 직전 주 일요일(시작일): 토요일 기준 6일 전
  const prevSunday = new Date(prevSaturday);
  prevSunday.setUTCDate(prevSaturday.getUTCDate() - 6);

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  return {
    start: fmt(prevSunday),
    end: fmt(prevSaturday),
    label: `${fmt(prevSunday)} ~ ${fmt(prevSaturday)} (EST 기준)`,
  };
}

async function gatherNewsWithClaude(
  client: Anthropic,
  weekRange: { start: string; end: string; label: string }
): Promise<string> {
  const systemPrompt = `당신은 미국 법률 산업 및 리걸테크 분야의 전문 애널리스트입니다.
웹 검색을 통해 최신 뉴스를 수집하고, 심층적인 분석 보고서를 작성합니다.
보고서는 한국어로 작성하되, 회사명·고유명사는 영문 원문을 유지합니다.`;

  const prevWeekEnd = new Date(weekRange.start);
  prevWeekEnd.setUTCDate(prevWeekEnd.getUTCDate() - 1);
  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setUTCDate(prevWeekEnd.getUTCDate() - 13); // 2주 전까지
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const userPrompt = `분석 대상 기간: ${weekRange.start} ~ ${weekRange.end} (EST 기준)

보고서 작성 전에 반드시 아래 3단계 절차를 따르세요.

━━━ STEP 1: 이미 알려진 이슈 파악 ━━━
${fmt(prevWeekStart)} ~ ${weekRange.start} 이전 2주간 미국 법률·리걸테크 업계에서 가장 많이 보도된 주요 이슈들을 먼저 검색하세요.
이 목록이 "기존 이슈 목록"이 됩니다.

━━━ STEP 2: 분석 기간 내 신규 뉴스 수집 ━━━
${weekRange.start} ~ ${weekRange.end} 사이에 발행된 기사를 4개 영역별로 검색하세요:
1. 미국 주요 로펌 (Big Law, AmLaw 100 등) 뉴스
2. 리걸테크 기업 (Clio, Thomson Reuters, LexisNexis, Harvey AI, Ironclad 등) 뉴스
3. 리걸테크 스타트업 투자·출시·M&A 뉴스
4. AI와 법률 산업의 결합 뉴스

각 기사에 대해 다음을 확인하세요:
- 기사 발행일이 ${weekRange.start} ~ ${weekRange.end} 범위 안에 있는가? (범위 밖이면 즉시 제외)
- 이 이슈가 STEP 1의 기존 이슈 목록에 있는가?

━━━ STEP 3: 신규성 검증 후 제외 기준 적용 ━━━
다음 중 하나라도 해당하면 보고서에서 제외하세요:
- STEP 1에서 파악한 기존 이슈의 단순 반복 또는 요약 재탕
- 이슈가 ${weekRange.start} 이전에 이미 세상에 알려진 내용이고, 이번 주에 실질적으로 새로운 전개(판결, 합의, 투자 클로징, 신제품 출시, 추가 피해 공개 등)가 없는 경우
- 단순히 "전문가가 과거 사건에 대해 논평한" 기사

포함 가능한 경우 (기존 이슈라도 아래 조건이면 포함 가능):
- 법적 판결이나 합의가 이번 주에 새로 났을 때
- 투자 라운드가 이번 주에 공식 클로징되거나 발표됐을 때
- 기존 이슈에서 완전히 새로운 당사자나 피해 규모가 이번 주에 추가로 밝혀졌을 때

━━━ 보고서 작성 ━━━
위 검증을 통과한 뉴스만으로 아래 형식에 맞춰 작성하세요.
마크다운 기호(#, **, --, 표 등)는 일절 사용하지 말고 순수 텍스트로만 작성하세요.

[미국 로펌·리걸테크 주간 동향 보고서]
기간: ${weekRange.label}

1. 이번 주 핵심 요약
(3~5개 가장 중요한 신규 뉴스를 1~2문장으로)

2. 미국 로펌 동향
(각 뉴스를 출처 URL과 함께 서술)

3. 리걸테크 기업 동향
(각 뉴스를 출처 URL과 함께 서술)

4. 리걸테크 스타트업 & 투자
(각 뉴스를 출처 URL과 함께 서술)

5. AI x 법률 산업
(각 뉴스를 출처 URL과 함께 서술)

6. 트렌드 인사이트
(이번 주 새로 확인된 패턴과 업계 방향성 분석)

전체 보고서는 9,000자를 넘지 않도록 작성하세요.
이번 주에 특별히 보도할 신규 뉴스가 부족한 영역은 "이번 주 특이사항 없음"으로 표기하세요.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
    messages: [{ role: "user", content: userPrompt }],
  });

  let report = "";
  for (const block of response.content) {
    if (block.type === "text") {
      report += block.text;
    }
  }
  return report;
}

// Teams MessageCard 페이로드 최대 크기: 28KB
// 한국어는 UTF-8에서 3바이트/자이므로 텍스트는 8,000자 이내로 분할
const TEAMS_CHUNK_CHARS = 8000;

async function postToTeams(teamsWebhookUrl: string, payload: object): Promise<void> {
  const res = await fetch(teamsWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Teams 전송 실패: ${res.status} ${res.statusText}`);
  }
}

async function sendToTeams(
  teamsWebhookUrl: string,
  report: string,
  weekLabel: string
): Promise<void> {
  // 보고서를 8,000자 단위로 분할 (한국어 3바이트/자 → 최대 ~24KB/청크)
  const chunks: string[] = [];
  for (let i = 0; i < report.length; i += TEAMS_CHUNK_CHARS) {
    chunks.push(report.substring(i, i + TEAMS_CHUNK_CHARS));
  }

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const suffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    const payload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "0078D4",
      summary: `미국 로펌·리걸테크 주간 보고서 (${weekLabel})`,
      sections: [
        {
          activityTitle: `📋 미국 로펌·리걸테크 주간 보고서${suffix}`,
          activitySubtitle: isFirst ? `분석 기간: ${weekLabel}` : "",
          text: chunks[i],
        },
      ],
    };
    await postToTeams(teamsWebhookUrl, payload);
  }
}

export default async (req: Request, context: Context) => {
  // 스케줄 트리거에서만 호출 허용 (무단 직접 호출 차단)
  const triggerSecret = process.env.TRIGGER_SECRET;
  if (triggerSecret) {
    const body = await req.json().catch(() => ({}));
    if (body.secret !== triggerSecret) {
      console.error("[legaltech-report] 인증 실패: 유효하지 않은 요청");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL || "";

  console.log("[legaltech-report] 시작");

  if (!apiKey) {
    console.error("[legaltech-report] ANTHROPIC_API_KEY가 설정되지 않았습니다.");
    return new Response("ANTHROPIC_API_KEY 환경변수가 없습니다.", { status: 500 });
  }

  if (!teamsWebhookUrl) {
    console.error("[legaltech-report] TEAMS_WEBHOOK_URL이 설정되지 않았습니다.");
    return new Response("TEAMS_WEBHOOK_URL 환경변수가 없습니다.", { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const weekRange = getWeekRange();
  console.log(`[legaltech-report] 분석 기간: ${weekRange.label}`);

  try {
    console.log("[legaltech-report] Claude API 호출 중...");
    const report = await gatherNewsWithClaude(client, weekRange);
    console.log(`[legaltech-report] 완료 (${report.length}자)`);

    await sendToTeams(teamsWebhookUrl, report, weekRange.label);
    console.log("[legaltech-report] Teams 전송 완료 ✅");
  } catch (error) {
    console.error("[legaltech-report] 오류:", error);

    if (teamsWebhookUrl) {
      await fetch(teamsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          "@context": "http://schema.org/extensions",
          themeColor: "FF0000",
          summary: "리걸테크 보고서 생성 오류",
          sections: [{
            activityTitle: "⚠️ 리걸테크 주간 보고서 생성 실패",
            activitySubtitle: `분석 기간: ${weekRange.label}`,
            text: `오류: ${error instanceof Error ? error.message : String(error)}`,
          }],
        }),
      });
    }
  }
};
