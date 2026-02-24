import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

function getWeekRange(): { start: string; end: string; label: string } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  return {
    start: fmt(monday),
    end: fmt(friday),
    label: `${fmt(monday)} ~ ${fmt(friday)}`,
  };
}

async function gatherNewsWithClaude(
  client: Anthropic,
  weekRange: { start: string; end: string; label: string }
): Promise<string> {
  const systemPrompt = `당신은 미국 법률 산업 및 리걸테크 분야의 전문 애널리스트입니다.
웹 검색을 통해 최신 뉴스를 수집하고, 심층적인 분석 보고서를 작성합니다.
보고서는 한국어로 작성하되, 회사명·고유명사는 영문 원문을 유지합니다.`;

  const userPrompt = `지난 주 (${weekRange.label}) 동안의 뉴스를 수집하고 종합 분석 보고서를 작성해주세요.

다음 4가지 영역을 각각 웹검색으로 수집하세요:
1. 미국 주요 로펌 (Big Law, AmLaw 100 등) 관련 최신 뉴스
2. 리걸테크 기업 (Clio, Thomson Reuters, LexisNexis, Harvey AI, Ironclad 등) 관련 뉴스
3. 리걸테크 스타트업 투자·출시·M&A 뉴스
4. AI와 법률 산업의 결합 관련 뉴스

수집 후 다음 형식으로 보고서를 작성하세요:

# 미국 로펌·리걸테크 주간 동향 보고서
기간: ${weekRange.label}

## 1. 이번 주 핵심 요약
## 2. 미국 로펌 동향
## 3. 리걸테크 기업 동향
## 4. 리걸테크 스타트업 & 투자
## 5. AI × 법률 산업
## 6. 트렌드 인사이트`;

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL || "";

  console.log("[legaltech-report] 시작");
  console.log(`[legaltech-report] API 키 존재: ${!!apiKey}`);
  console.log(`[legaltech-report] Teams URL 존재: ${!!teamsWebhookUrl}`);

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
