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

  const userPrompt = `${weekRange.start}부터 ${weekRange.end}까지 (EST 기준 일요일 00:00 ~ 토요일 24:00) 딱 이 기간에 발행된 뉴스만 수집하세요. 이 날짜 범위를 벗어난 뉴스는 아무리 관련성이 높아도 포함하지 마세요. 웹 검색 시 날짜 필터를 반드시 적용하고, 검색 결과에서 날짜를 확인해 기간 내 기사만 선별하세요.

다음 4가지 영역을 각각 웹검색으로 수집하세요:
1. 미국 주요 로펌 (Big Law, AmLaw 100 등) 관련 최신 뉴스
2. 리걸테크 기업 (Clio, Thomson Reuters, LexisNexis, Harvey AI, Ironclad 등) 관련 뉴스
3. 리걸테크 스타트업 투자·출시·M&A 뉴스
4. AI와 법률 산업의 결합 관련 뉴스

수집 후 다음 형식으로 보고서를 작성하세요. 마크다운 기호(#, **, --, 표 등)는 일절 사용하지 말고 순수 텍스트로만 작성하세요.

[미국 로펌·리걸테크 주간 동향 보고서]
기간: ${weekRange.label}

1. 이번 주 핵심 요약
(3~5개 가장 중요한 뉴스를 1~2문장으로)

2. 미국 로펌 동향
(각 뉴스를 출처 URL과 함께 서술)

3. 리걸테크 기업 동향
(각 뉴스를 출처 URL과 함께 서술)

4. 리걸테크 스타트업 & 투자
(각 뉴스를 출처 URL과 함께 서술)

5. AI x 법률 산업
(각 뉴스를 출처 URL과 함께 서술)

6. 트렌드 인사이트
(이번 주 패턴과 업계 방향성 분석)`;

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

async function sendToTeams(
  teamsWebhookUrl: string,
  report: string,
  weekLabel: string
): Promise<void> {
  const payload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "0078D4",
    summary: `미국 로펌·리걸테크 주간 보고서 (${weekLabel})`,
    sections: [
      {
        activityTitle: `📋 미국 로펌·리걸테크 주간 보고서`,
        activitySubtitle: `분석 기간: ${weekLabel}`,
        text: report.substring(0, 25000),
      },
    ],
  };

  const res = await fetch(teamsWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Teams 전송 실패: ${res.status} ${res.statusText}`);
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
