/**
 * AIアプリ 定期点検スクリプト
 *
 * 使い方：worker フォルダで  node health-check.mjs
 *         （Windows なら health-check.bat をダブルクリック）
 *
 * 何を見るか：
 *   1. 中継サーバーが動いているか、APIキーが登録されているか
 *   2. モデルが実際に使えるか（廃止されていないか）← 今回の障害の原因
 *   3. 実際に文章生成が通るか（thinkingブロック対応を含む）
 *   4. 公開中の各アプリにキーが混入していないか、正しく中継サーバーを向いているか
 *
 * 月1回くらい実行すれば、職員が気づく前に異常を見つけられます。
 */

const BASE = 'https://kokoiku-api.yamanaka504s.workers.dev';
const ORIGIN = 'https://yamanaka504s.github.io';

// 公開中のアプリ（GitHub Pages ＋ Google App Engine）
const SITES = [
  ['ココイク（個別外出計画）', 'https://yamanaka504s.github.io/kokoiku/index.html'],
  ['誕生日計画', 'https://yamanaka504s.github.io/birthday-plan/index.html'],
  ['ケアプラン', 'https://yamanaka504s.github.io/ho-chan/index.html'],
  ['ケアプランショート', 'https://yamanaka504s.github.io/ho-chan-short/index.html'],
  ['居宅ケアプラン', 'https://yamanaka504s.github.io/ho-chan-kyotaku/index.html'],
  // App Engine（更新は git push ではなく gcloud app deploy が必要）
  ['月報', 'https://geppo-dot-gen-lang-client-0179925161.an.r.appspot.com/'],
  ['週報', 'https://shuho-dot-gen-lang-client-0179925161.an.r.appspot.com/'],
];

// 各アプリが使うモデル（アプリ側の指定と合わせること）
const MODELS = ['auto', 'claude-haiku-4-5'];

let ok = 0, ng = 0;
const results = [];
const check = (name, pass, detail = '') => {
  pass ? ok++ : ng++;
  results.push({ name, pass, detail });
  console.log(`${pass ? '  OK  ' : ' ★NG  '} ${name}${detail ? '  — ' + detail : ''}`);
};

console.log('=== 1. 中継サーバー ===');
let health = null;
try {
  const r = await fetch(BASE + '/health', { headers: { Origin: ORIGIN } });
  health = await r.json();
  check('中継サーバーが応答している', r.status === 200 && health.ok === true);
  check('Anthropicのキーが登録されている', health.anthropic_key === true, health.anthropic_key ? '' : 'Cloudflareで ANTHROPIC_API_KEY を登録してください');
  check('OpenAIのキーが登録されている', health.openai_key === true, health.openai_key ? '' : 'Cloudflareで OPENAI_API_KEY を登録してください');
  console.log(`       1日の上限設定: ${health.daily_limit}`);
} catch (e) {
  check('中継サーバーが応答している', false, e.message);
}

console.log('\n=== 2〜3. モデルと文章生成 ===');
for (const m of MODELS) {
  try {
    const r = await fetch(BASE + '/claude/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ model: m, max_tokens: 64, messages: [{ role: 'user', content: 'OKとだけ返して' }] }),
    });
    const j = await r.json().catch(() => ({}));
    // thinkingブロックが先頭に来ても本文が取れることをここで確認している
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    check(`model='${m}' で生成できる`, r.status === 200 && text.length > 0,
      r.status === 200 ? `使用モデル: ${j.model}` : `${r.status} ${JSON.stringify(j.error || j).slice(0, 120)}`);
  } catch (e) {
    check(`model='${m}' で生成できる`, false, e.message);
  }
}

console.log('\n=== 4. 公開中のアプリ ===');
for (const [name, url] of SITES) {
  try {
    const r = await fetch(url + '?cb=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) { check(name, false, `ページが開けない (${r.status})`); continue; }
    const html = await r.text();
    const bad = [];
    if (/sk-ant-api03-\w|sk-proj-\w{10}/.test(html)) bad.push('APIキーが混入している');
    if (/api\.anthropic\.com|api\.openai\.com/.test(html)) bad.push('APIを直接呼んでいる');
    if (/content\[0\]\.text/.test(html)) bad.push('content[0].text が残っている');
    if (!html.includes(BASE)) bad.push('中継サーバーを向いていない');
    check(name, bad.length === 0, bad.join(' / '));
  } catch (e) {
    check(name, false, e.message);
  }
}

console.log('\n' + '='.repeat(60));
if (ng === 0) {
  console.log(`すべて正常です（${ok}項目）。`);
} else {
  console.log(`★ ${ng}項目に問題があります（正常 ${ok}項目）。`);
  console.log('\n問題のあった項目:');
  results.filter(r => !r.pass).forEach(r => console.log(`  ・${r.name}${r.detail ? '：' + r.detail : ''}`));
  console.log('\n対処法は worker/README.md の「困ったときは」を参照してください。');
}
console.log('='.repeat(60));

process.exit(ng ? 1 : 0);
