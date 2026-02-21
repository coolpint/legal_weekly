# 미국 로펌·리걸테크 주간 보고서 자동화

매주 월요일 오전 9시(KST)에 Claude AI가 웹검색으로 뉴스를 수집·분석하고, Teams로 자동 전송합니다.

---

## 배포 방법

### 1단계: 환경 변수 설정

Netlify 대시보드 → Site configuration → Environment variables 에서 추가:

| 변수명 | 값 | 설명 |
|--------|-----|------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic API 키 |
| `TEAMS_WEBHOOK_URL` | `https://...webhook.office.com/...` | Teams 인커밍 웹훅 URL |

> `URL` 변수는 Netlify가 자동으로 설정해줍니다 (배포된 사이트 URL).

### 2단계: Teams 웹훅 URL 생성

1. Teams에서 보고서를 받을 채널 우클릭 → **채널 관리**
2. **Connectors** 탭 → **Incoming Webhook** → 구성
3. 이름 입력 (예: `리걸테크 위클리`) → URL 복사 → 위 변수에 붙여넣기

### 3단계: 배포

```bash
# 의존성 설치
npm install

# Netlify에 배포 (GitHub 연동 또는 직접 배포)
netlify deploy --prod
```

또는 GitHub 저장소에 Push 후 Netlify에서 자동 배포.

---

## 실행 스케줄

- **자동 실행**: 매주 월요일 00:00 UTC = 09:00 KST
- **수동 테스트**:
  ```bash
  # 보고서 즉시 생성 테스트
  netlify functions:invoke legaltech-report-background
  ```

---

## 함수 구조

```
netlify/functions/
├── legaltech-weekly-trigger.mts    # 스케줄 함수 (매주 월 00:00 UTC)
└── legaltech-report-background.mts # 백그라운드 함수 (실제 보고서 생성)
```

**흐름:**
1. `legaltech-weekly-trigger` → 매주 월요일 자동 실행
2. → `legaltech-report-background` 호출 (최대 15분 실행 가능)
3. → Claude API + 웹검색으로 뉴스 4개 영역 수집
4. → 분석 보고서 생성 (한국어)
5. → Teams 채널로 전송

---

## 보고서 구성

1. **핵심 요약** - 이번 주 가장 중요한 뉴스 3~5개
2. **미국 로펌 동향** - Big Law, AmLaw 100 등
3. **리걸테크 기업 동향** - Harvey AI, Clio, Thomson Reuters 등
4. **리걸테크 스타트업 & 투자** - 펀딩, 출시, M&A
5. **AI × 법률 산업** - AI 도구 도입, 규제, 판례
6. **트렌드 인사이트** - 패턴 분석 및 업계 방향성

---

## 비용 추정

- **Anthropic API**: claude-opus-4-6 사용, 주당 약 $0.50~1.00 (검색 포함)
- **Netlify**: 무료 플랜으로 충분 (스케줄 함수 포함)
- **Teams 웹훅**: 무료
