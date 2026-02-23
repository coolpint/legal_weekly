import type { Context } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const TEAMS_WEBHOOK_URL = Netlify.env.get("TEAMS_WEBHOOK_URL") || "";

// 이번 주 월~금 날짜 범위 계산
function getWeekRange(): { start: string; end: string; label: string } {
  const now = new Date();
  // KST 기준
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=일, 1=월 ... 6=토
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

async function gatherNewsWithClaude(weekRange: {
  start: string;
  end: string;
  label: string;
}): Promise<string> {
  const systemPrompt = `당신은 미국 법률 산업 및 리걸테크 분야의 전문 애널리스트입니다.
웹 검색을 통해 최신 뉴스를 수집하고, 심층적인 분석 보고서를 작성합니다.
보고서는 한국어로 작성하되, 회사명·고유명사는 영문 원문을 유지합니다.`;

  const userPrompt = `지난 주 (${weekRange.label}) 동안의 뉴스를 수집하고 종합 분석 보고서를 작성해주세요.

다음 4가지 영역을 각각 웹검색으로 수집하세요:
1. 미국 주요 로펌 (Big Law, AmLaw 100 등) 관련 최신 뉴스
2. 리걸테크 기업 (Clio, Thomson Reuters, LexisNexis, Harvey AI, Ironclad 등) 관련 뉴스
3. 리걸테크 스타트업 투자·출시·M&A 뉴스
4. AI와 법률 산업의 결합 관련 뉴스 (AI 도구 도입, 판례, 규제 등)

수집 후 다음 형식으로 보고서를 작성하세요:

---
# 미국 로펌·리걸테크 주간 동향 보고서
**기간:** ${weekRange.label}
**작성:** AI 분석 시스템 | 매주 월요일 발행

## 1. 이번 주 핵심 요약
(3~5개 가장 중요한 뉴스를 1~2문장으로)

## 2. 미국 로펌 동향
(각 뉴스에 출처 URL 포함, 유사 내용 통합)

## 3. 리걸테크 기업 동향
(각 뉴스에 출처 URL 포함, 유사 내용 통합)

## 4. 리걸테크 스타트업 & 투자
(각 뉴스에 출처 URL 포함)

## 5. AI × 법률 산업
(각 뉴스에 출처 URL 포함)

## 6. 트렌드 인사이트
(이번 주 뉴스에서 발견한 패턴, 업계 방향성, 주목할 시사점을 분석)

---

검색 시 다음 키워드를 활용하세요:
- "law firm news 2025"
- "legal tech startup funding 2025"  
- "AI legal technology 2025"
- "Big Law merger acquisition 2025"
- "Harvey AI Clio LexisNexis news"`;

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    tools: [
      {
        type: "web_search_20250305" as const,
        name: "web_search",
      },
    ],
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  // 최종 텍스트 응답 추출
  let report = "";
  for (const block of response.content) {
    if (block.type === "text") {
      report += block.text;
    }
  }

  return report;
}

async function sendToTeams(report: string, weekLabel: string): Promise<void> {
  // Teams Adaptive Card 형식
  const teamsPayload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.3",
          body: [
            {
              type: "TextBlock",
              text: `📋 미국 로펌·리걸테크 주간 보고서`,
              weight: "Bolder",
              size: "Large",
              color: "Accent",
            },
            {
              type: "TextBlock",
              text: `분석 기간: ${weekLabel}`,
              size: "Small",
              isSubtle: true,
              spacing: "None",
            },
            {
              type: "TextBlock",
              text: "─────────────────────────",
              spacing: "None",
              isSubtle: true,
            },
            {
              type: "TextBlock",
              text: report,
              wrap: true,
              spacing: "Medium",
            },
          ],
        },
      },
    ],
  };

  const res = await fetch(TEAMS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(teamsPayload),
  });

  if (!res.ok) {
    // Fallback: 구형 MessageCard 형식 시도
    const fallbackPayload = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: "0078D4",
      summary: `미국 로펌·리걸테크 주간 보고서 (${weekLabel})`,
      sections: [
        {
          activityTitle: `📋 미국 로펌·리걸테크 주간 보고서`,
          activitySubtitle: `분석 기간: ${weekLabel}`,
          text: report.substring(0, 25000), // Teams 메시지 길이 제한
        },
      ],
    };

    const fallbackRes = await fetch(TEAMS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fallbackPayload),
    });

    if (!fallbackRes.ok) {
      throw new Error(
        `Teams 전송 실패: ${fallbackRes.status} ${fallbackRes.statusText}`
      );
    }
  }
}

export default async (req: Request, context: Context) => {
  console.log("[legaltech-report] 보고서 생성 시작");

  const weekRange = getWeekRange();
  console.log(`[legaltech-report] 분석 기간: ${weekRange.label}`);

  try {
    // 1. Claude로 뉴스 수집 및 보고서 생성
    console.log("[legaltech-report] Claude API 호출 중...");
    const report = await gatherNewsWithClaude(weekRange);
    console.log(`[legaltech-report] 보고서 생성 완료 (${report.length}자)`);

    // 2. Teams로 전송
    console.log("[legaltech-report] Teams 전송 중...");
    await sendToTeams(report, weekRange.label);
    console.log("[legaltech-report] Teams 전송 완료 ✅");
  } catch (error) {
    console.error("[legaltech-report] 오류 발생:", error);

    // 오류 발생 시 Teams에 오류 알림
    if (TEAMS_WEBHOOK_URL) {
      await fetch(TEAMS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          "@context": "http://schema.org/extensions",
          themeColor: "FF0000",
          summary: "리걸테크 보고서 생성 오류",
          sections: [
            {
              activityTitle: "⚠️ 리걸테크 주간 보고서 생성 실패",
              activitySubtitle: `분석 기간: ${weekRange.label}`,
              text: `오류: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        }),
      });
    }
  }
};
