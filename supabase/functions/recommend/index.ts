// Supabase Edge Function: recommend
// 내 기록을 읽고 Claude API로 새로운 책/영화/음악/취미를 추천합니다.
//
// 필요한 시크릿 (Edge Functions → Secrets 또는 `supabase secrets set`):
//   ANTHROPIC_API_KEY  : Anthropic 콘솔에서 발급한 키
//   OWNER_EMAIL        : schema.sql 의 is_owner() 에 넣은 것과 같은 이메일
// SUPABASE_URL, SUPABASE_ANON_KEY 는 Supabase가 자동으로 넣어 줍니다.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "claude-sonnet-5-5"; // 최신 모델 이름은 https://docs.claude.com 에서 확인

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const LABEL: Record<string, string> = { book: "책", movie: "영화", music: "음악", hobby: "취미" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST 요청만 받아요." }, 405);

  try {
    // 1) 주인인지 확인
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    const owner = (Deno.env.get("OWNER_EMAIL") ?? "").toLowerCase();
    if (!user || (user.email ?? "").toLowerCase() !== owner) {
      return json({ error: "추천은 주인 계정으로 로그인했을 때만 받을 수 있어요." }, 401);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY 시크릿이 설정되지 않았어요." }, 500);

    const body = await req.json().catch(() => ({}));
    const focus = ["book", "movie", "music", "hobby"].includes(body?.focus) ? body.focus : "all";

    // 2) 기록 읽기 (RLS 덕분에 주인의 비공개 기록까지 포함)
    const { data: entries, error } = await supabase
      .from("entries")
      .select("category,title,rating,tags,meta,content,entry_date")
      .order("entry_date", { ascending: false })
      .limit(120);
    if (error) throw error;
    if (!entries || entries.length < 3) {
      return json({ error: "추천하려면 기록이 3개 이상 필요해요." }, 400);
    }

    const { data: saved } = await supabase.from("recommendations").select("title");
    const exclude = [...new Set([...entries.map((e) => e.title), ...(saved ?? []).map((s) => s.title)])];

    const records = entries.map((e) => ({
      종류: e.category,
      제목: e.title,
      날짜: e.entry_date,
      별점: e.rating,
      태그: e.tags,
      정보: e.meta,
      느낀점: (e.content ?? "").slice(0, 220),
    }));

    const count = focus === "all" ? "책, 영화, 음악, 취미를 각각 2개씩 모두 8개" : `${LABEL[focus]}만 5개`;

    const system =
      "너는 한 사람의 개인 기록장을 읽고 그 사람의 취향을 깊이 이해해서, 아직 경험하지 않은 새로운 것을 추천하는 큐레이터야. " +
      "응답은 반드시 JSON 객체 하나만 출력하고, 앞뒤에 설명이나 마크다운 코드블록을 붙이지 마.";

    const prompt = `아래는 나의 기록이야 (책, 영화, 음악, 여행, 데이트, 운동).

${JSON.stringify(records)}

이 기록을 바탕으로 ${count}를 추천해 줘.

규칙:
- 실제로 존재하는 작품만 추천해. 확실하지 않으면 추천하지 마.
- 이미 경험한 것은 제외해: ${JSON.stringify(exclude)}
- 별점이 높은 기록과 자주 쓴 태그, 느낀 점의 결을 근거로 골라.
- 익숙한 취향을 이어가는 것과, 조금 새로운 방향으로 넓혀 주는 것을 섞어.
- 취미는 여행, 데이트, 운동 기록에서 보이는 생활 패턴도 반영해서 현실적으로 시작할 수 있는 활동으로.
- reason 은 내 기록 중 무엇과 어떻게 이어지는지 구체적으로, 한국어 2문장 이내.

출력 형식:
{"items":[{"category":"book|movie|music|hobby","title":"제목","creator":"저자/감독/아티스트 (취미는 빈 문자열)","reason":"추천 이유","first_step":"취미일 때 시작하는 방법 한 줄, 아니면 빈 문자열"}]}`;

    // 3) Claude API 호출
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Anthropic error", res.status, detail);
      return json({ error: `추천 엔진이 응답하지 않았어요 (${res.status}). API 키와 모델 이름을 확인해 주세요.` }, 502);
    }

    const data = await res.json();
    const text = (data.content ?? []).map((b: { type: string; text?: string }) => (b.type === "text" ? b.text : "")).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    const parsed = JSON.parse(clean.slice(start, end + 1));

    const items = (parsed.items ?? [])
      .filter((i: Record<string, string>) => i && i.title && LABEL[i.category])
      .map((i: Record<string, string>) => ({
        category: i.category,
        title: String(i.title),
        creator: String(i.creator ?? ""),
        reason: String(i.reason ?? ""),
        first_step: String(i.first_step ?? ""),
      }));

    return json({ items });
  } catch (e) {
    console.error(e);
    return json({ error: "추천을 만드는 중에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
});
