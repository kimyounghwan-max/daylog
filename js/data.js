// 데이터 저장소
// - Supabase 설정이 있으면 Supabase 사용
// - 없으면 브라우저 localStorage 에 저장하는 데모 모드
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const useSupabase = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function normalize(e) {
    return { ...e, tags: e.tags || [], meta: e.meta || {}, is_private: !!e.is_private };
  }

  /* ------------------------------------------------------------------ */
  /* Supabase                                                            */
  /* ------------------------------------------------------------------ */
  function supabaseStore() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    async function upload(file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${new Date().getFullYear()}/${uid()}.${ext}`;
      const { error } = await sb.storage.from('photos').upload(path, file, { cacheControl: '31536000', upsert: false });
      if (error) throw new Error('사진을 올리지 못했어요: ' + error.message);
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    }

    async function functionError(error) {
      try {
        const body = await error.context.json();
        if (body && body.error) return new Error(body.error);
      } catch (_) { /* 본문이 JSON이 아님 */ }
      return new Error(error.message || '추천 함수를 부르지 못했어요.');
    }

    return {
      mode: 'supabase',
      async getSession() {
        const { data } = await sb.auth.getSession();
        return data.session;
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((_event, session) => cb(session));
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error('이메일 또는 비밀번호가 맞지 않아요.');
      },
      async signOut() {
        await sb.auth.signOut();
      },

      async listEntries() {
        const { data, error } = await sb
          .from('entries')
          .select('*')
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (error) throw new Error('기록을 불러오지 못했어요: ' + error.message);
        return data.map(normalize);
      },
      async saveEntry(entry, file) {
        const row = { ...entry };
        delete row.created_at;
        delete row.user_id;
        if (file) row.image_url = await upload(file);
        let res;
        if (row.id) {
          const id = row.id;
          delete row.id;
          res = await sb.from('entries').update(row).eq('id', id).select().single();
        } else {
          delete row.id;
          res = await sb.from('entries').insert(row).select().single();
        }
        if (res.error) throw new Error('저장하지 못했어요: ' + res.error.message);
        return normalize(res.data);
      },
      async deleteEntry(id) {
        const { error } = await sb.from('entries').delete().eq('id', id);
        if (error) throw new Error('지우지 못했어요: ' + error.message);
      },

      async recommend(focus) {
        const { data, error } = await sb.functions.invoke('recommend', { body: { focus } });
        if (error) throw await functionError(error);
        if (data && data.error) throw new Error(data.error);
        return (data && data.items) || [];
      },
      async listSaved() {
        const { data, error } = await sb.from('recommendations').select('*').order('created_at', { ascending: false });
        if (error) throw new Error('담아둔 추천을 불러오지 못했어요: ' + error.message);
        return data;
      },
      async saveRec(rec) {
        const { data, error } = await sb
          .from('recommendations')
          .insert({ category: rec.category, title: rec.title, creator: rec.creator || '', reason: rec.reason || '', note: rec.first_step || '' })
          .select()
          .single();
        if (error) throw new Error('담지 못했어요: ' + error.message);
        return data;
      },
      async updateRec(id, patch) {
        const { data, error } = await sb.from('recommendations').update(patch).eq('id', id).select().single();
        if (error) throw new Error('바꾸지 못했어요: ' + error.message);
        return data;
      },
      async deleteRec(id) {
        const { error } = await sb.from('recommendations').delete().eq('id', id);
        if (error) throw new Error('지우지 못했어요: ' + error.message);
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* 데모 (localStorage)                                                 */
  /* ------------------------------------------------------------------ */
  function localStore() {
    const KEY = 'daylog-demo-v1';
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

    function seed() {
      const list = [
        { category: 'book', title: '소년이 온다', entry_date: daysAgo(1), rating: 5, tags: ['문학', '기억', '슬픔'],
          meta: { author: '한강' },
          content: '한 장을 넘길 때마다 숨을 고르게 됐다. 문장이 차분할수록 더 아팠다.\n\n2인칭 "너"로 불릴 때, 나도 그 자리에 서 있는 것 같았다. 오래 곁에 둘 책.' },
        { category: 'music', title: 'Come Away with Me', entry_date: daysAgo(3), rating: 4, tags: ['재즈', '밤', '잔잔함'],
          meta: { artist: 'Norah Jones', album: 'Come Away with Me' },
          content: '비 오는 밤 창문 열어 두고 들었다. 피아노 소리가 방 안 공기를 천천히 바꿔 놓는 느낌.' },
        { category: 'date', title: '성수동 전시 보고 한강까지 걷기', entry_date: daysAgo(6), rating: 5, tags: ['전시', '산책', '데이트'],
          meta: { place: '성수동, 뚝섬한강공원', with: 'J' },
          content: '전시보다 전시 끝나고 나눈 이야기가 더 좋았다. 해 지는 강변에서 각자 제일 좋았던 작품 하나씩 꼽기.' },
        { category: 'movie', title: '헤어질 결심', entry_date: daysAgo(10), rating: 4, tags: ['미스터리', '사랑', '영상미'],
          meta: { director: '박찬욱', where: '집, OTT' },
          content: '두 번째 보니 처음엔 지나쳤던 대사들이 보였다. 안개처럼 흐릿한 감정을 화면으로 만든다는 게 신기하다.' },
        { category: 'travel', title: '강릉 1박 2일', entry_date: daysAgo(17), rating: 5, tags: ['바다', '카페', '여행'],
          meta: { place: '강릉 안목해변, 주문진', with: '혼자' },
          content: '아침 일찍 바다 앞에서 커피. 아무 계획 없이 걷다가 들어간 작은 서점에서 오래 머물렀다.\n\n혼자 여행은 생각이 정리되는 속도가 다르다.' },
        { category: 'book', title: '물고기는 존재하지 않는다', entry_date: daysAgo(24), rating: 4, tags: ['논픽션', '과학', '상실'],
          meta: { author: '룰루 밀러' },
          content: '과학책인 줄 알았는데 결국 삶을 어떻게 붙잡을지에 대한 이야기였다. 마지막 장에서 한참 멈춰 있었다.' },
        { category: 'movie', title: 'Her', entry_date: daysAgo(33), rating: 4, tags: ['사랑', 'SF', '고독'],
          meta: { director: '스파이크 존즈', where: '집' },
          content: '색감이 따뜻한데 이야기는 쓸쓸하다. 누군가를 이해한다는 것에 대해 오래 생각했다.' },
        { category: 'music', title: 'Lover, You Should\'ve Come Over', entry_date: daysAgo(41), rating: 5, tags: ['포크', '밤', '그리움'],
          meta: { artist: 'Jeff Buckley', album: 'Grace' },
          content: '후반부로 갈수록 목소리가 무너지듯 커지는 순간. 이어폰 볼륨을 올리게 된다.' },
      ];

      const types = ['러닝', '웨이트', '요가', '러닝', '사이클'];
      const notes = ['몸이 가벼웠다.', '마지막 1km가 힘들었지만 페이스 유지.', '스트레칭을 길게 했다.', '', '어깨가 한결 풀렸다.'];
      for (let i = 0, k = 0; i < 84; i += (k % 3 === 0 ? 3 : 2), k++) {
        const type = types[k % types.length];
        const meta = { type, minutes: type === '요가' ? 40 : type === '웨이트' ? 55 : 30 + ((k * 7) % 25) };
        if (type === '러닝') meta.distance = Number((4 + ((k * 13) % 40) / 10).toFixed(1));
        if (type === '사이클') meta.distance = 18 + (k % 5) * 3;
        list.push({ category: 'workout', title: `${type} ${meta.minutes}분`, entry_date: daysAgo(i + 1), rating: 3 + (k % 3 === 0 ? 1 : 0),
          tags: [], meta, content: notes[k % notes.length] });
      }
      return list.map((e, i) => normalize({ id: uid() + i, created_at: new Date().toISOString(), image_url: null, ...e }));
    }

    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) { /* 저장소 사용 불가 */ }
      return { entries: seed(), recs: [] };
    }
    let db = load();
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (_) { throw new Error('브라우저 저장 공간이 가득 찼어요. 더 작은 사진을 써 주세요.'); }
    }
    const readFile = (file) => new Promise((res, rej) => {
      if (file.size > 1.5 * 1024 * 1024) return rej(new Error('데모 모드에서는 1.5MB 이하 사진만 올릴 수 있어요.'));
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('사진을 읽지 못했어요.'));
      r.readAsDataURL(file);
    });
    const sortEntries = (a, b) => (b.entry_date || '').localeCompare(a.entry_date || '') || (b.created_at || '').localeCompare(a.created_at || '');

    const POOL = [
      { category: 'book', title: '작별하지 않는다', creator: '한강', tags: ['문학', '기억', '슬픔'] },
      { category: 'book', title: '달리기를 말할 때 내가 하고 싶은 이야기', creator: '무라카미 하루키', tags: ['러닝', '에세이', '일상'] },
      { category: 'book', title: '여행의 이유', creator: '김영하', tags: ['여행', '에세이', '혼자'] },
      { category: 'book', title: '아주 희미한 빛으로도', creator: '최은영', tags: ['문학', '관계', '잔잔함'] },
      { category: 'movie', title: '애프터썬', creator: '샬롯 웰스', tags: ['기억', '여름', '잔잔함'] },
      { category: 'movie', title: '패스트 라이브즈', creator: '셀린 송', tags: ['사랑', '그리움', '관계'] },
      { category: 'movie', title: '퍼펙트 데이즈', creator: '빔 벤더스', tags: ['일상', '음악', '고독'] },
      { category: 'movie', title: '비포 선라이즈', creator: '리처드 링클레이터', tags: ['여행', '데이트', '사랑'] },
      { category: 'music', title: 'Carrie & Lowell', creator: 'Sufjan Stevens', tags: ['포크', '상실', '밤'] },
      { category: 'music', title: 'Blue', creator: 'Joni Mitchell', tags: ['포크', '그리움', '사랑'] },
      { category: 'music', title: 'Waltz for Debby', creator: 'Bill Evans Trio', tags: ['재즈', '밤', '잔잔함'] },
      { category: 'music', title: 'For Emma, Forever Ago', creator: 'Bon Iver', tags: ['포크', '고독', '겨울'] },
      { category: 'hobby', title: '필름 카메라 들고 동네 산책', creator: '', tags: ['산책', '전시', '여행'], first_step: '일회용 필름 카메라 하나로 한 롤(27장)만 찍어 보기' },
      { category: 'hobby', title: '트레일 러닝 입문', creator: '', tags: ['러닝', '산책', '바다'], first_step: '평소 러닝 거리의 절반으로 가까운 둘레길 코스 달리기' },
      { category: 'hobby', title: '재즈 바에서 라이브 듣기', creator: '', tags: ['재즈', '밤', '데이트'], first_step: '평일 이른 시간 공연 하나 골라 가 보기' },
      { category: 'hobby', title: '도자기 원데이 클래스', creator: '', tags: ['데이트', '전시', '일상'], first_step: '주말 오전 물레 체험 클래스 예약하기' },
    ];

    return {
      mode: 'demo',
      async getSession() { return { demo: true, user: { email: 'demo' } }; },
      onAuthChange() {},
      async signIn() {},
      async signOut() {},

      async listEntries() { return [...db.entries].sort(sortEntries); },
      async saveEntry(entry, file) {
        const row = { ...entry };
        if (file) row.image_url = await readFile(file);
        if (row.id) {
          db.entries = db.entries.map((e) => (e.id === row.id ? normalize({ ...e, ...row }) : e));
        } else {
          row.id = uid();
          row.created_at = new Date().toISOString();
          db.entries.push(normalize(row));
        }
        persist();
        return row;
      },
      async deleteEntry(id) { db.entries = db.entries.filter((e) => e.id !== id); persist(); },

      async recommend(focus) {
        await new Promise((r) => setTimeout(r, 900));
        const score = {};
        db.entries.forEach((e) => (e.tags || []).forEach((t) => { score[t] = (score[t] || 0) + (e.rating || 3); }));
        const known = new Set([...db.entries.map((e) => e.title), ...db.recs.map((r) => r.title)]);
        const ranked = POOL
          .filter((p) => !known.has(p.title) && (focus === 'all' || p.category === focus))
          .map((p) => {
            const hits = p.tags.filter((t) => score[t]);
            return { ...p, hits, s: hits.reduce((a, t) => a + score[t], 0) + Math.random() * 3 };
          })
          .sort((a, b) => b.s - a.s);
        const picked = focus === 'all'
          ? ['book', 'movie', 'music', 'hobby'].flatMap((c) => ranked.filter((p) => p.category === c).slice(0, 2))
          : ranked.slice(0, 4);
        return picked.map((p) => ({
          category: p.category, title: p.title, creator: p.creator, first_step: p.first_step || '',
          reason: p.hits.length
            ? `기록에 자주 등장한 '${p.hits.join("', '")}' 취향과 닿아 있어요. (데모 추천)`
            : '평소 기록과 결이 조금 다른 것을 하나 섞었어요. (데모 추천)',
        }));
      },
      async listSaved() { return [...db.recs]; },
      async saveRec(rec) {
        const row = { id: uid(), category: rec.category, title: rec.title, creator: rec.creator || '', reason: rec.reason || '',
          note: rec.first_step || '', status: 'saved', created_at: new Date().toISOString() };
        db.recs.unshift(row); persist(); return row;
      },
      async updateRec(id, patch) {
        let out;
        db.recs = db.recs.map((r) => (r.id === id ? (out = { ...r, ...patch }) : r));
        persist(); return out;
      },
      async deleteRec(id) { db.recs = db.recs.filter((r) => r.id !== id); persist(); },
    };
  }

  window.Store = useSupabase ? supabaseStore() : localStore();
})();
