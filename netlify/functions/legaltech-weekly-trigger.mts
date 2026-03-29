import type { Config } from "@netlify/functions";

// 매주 일요일 22:03 UTC = 월요일 07:03 KST
export const config: Config = {
  schedule: "3 22 * * 0",
};

export default async (req: Request) => {
  const { next_run } = await req.json();
  console.log(`[legaltech-trigger] 실행됨. 다음 실행: ${next_run}`);

  // 백그라운드 함수 호출
  const siteUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL");

  if (!siteUrl) {
    console.error("[legaltech-trigger] URL 환경변수가 없습니다.");
    return;
  }

  const backgroundUrl = `${siteUrl}/.netlify/functions/legaltech-report-background`;

  try {
    const response = await fetch(backgroundUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      triggered_at: new Date().toISOString(),
      secret: Netlify.env.get("TRIGGER_SECRET") || "",
    }),
    });

    if (response.ok || response.status === 202) {
      console.log(
        "[legaltech-trigger] 백그라운드 함수 호출 성공 (202 Accepted)"
      );
    } else {
      console.error(
        `[legaltech-trigger] 백그라운드 함수 호출 실패: ${response.status}`
      );
    }
  } catch (error) {
    console.error("[legaltech-trigger] 호출 오류:", error);
  }
};
