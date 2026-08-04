/**
 * ココイク / 誕生日計画 ほか AIアプリ共通  APIキー中継サーバー（Cloudflare Worker）
 *
 * 目的：APIキーをブラウザに置かず、このサーバーの中だけで保持する。
 *       ブラウザからはこのWorkerを呼び、Workerがキーを付けて本家APIへ転送する。
 *
 * 【必須の設定（Cloudflareの管理画面 → 設定 → 変数とシークレット）】
 *   ANTHROPIC_API_KEY   … シークレットとして登録（Claude用）
 *   OPENAI_API_KEY      … シークレットとして登録（画像生成用）
 *
 * 【任意の設定】
 *   ALLOWED_ORIGINS  … 呼び出しを許可するサイト。カンマ区切り。未設定なら下のDEFAULT_ORIGINSを使用
 *   DAILY_LIMIT      … 1日の呼び出し上限（既定 500）。日本時間の0時にリセット
 *   COUNTER          … KVネームスペースを this 名前で紐付けると1日上限が有効になる（任意）
 *
 * ※このファイルは公開リポジトリに入っていても問題ありません。キーは含まれていません。
 */

// 呼び出しを許可するサイト（ALLOWED_ORIGINS 未設定時に使われる）
const DEFAULT_ORIGINS = [
  'https://yamanaka504s.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// 使用を許可するモデル（想定外の高額モデルで悪用されるのを防ぐ）
const ALLOWED_CLAUDE_MODEL = /sonnet|haiku/i;
const ALLOWED_IMAGE_MODEL = /^gpt-image/i;

// 1リクエストあたりの max_tokens の上限（アプリ側の指定がこれを超えたら切り下げる）
const MAX_TOKENS_CAP = 8192;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    // ブラウザの事前確認（プリフライト）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    try {
      switch (`${request.method} ${path}`) {
        case 'GET /claude/models':
          return await proxy(
            'https://api.anthropic.com/v1/models?limit=100',
            { method: 'GET', headers: anthropicHeaders(env) },
            cors
          );

        case 'POST /claude/messages': {
          const limited = await checkDailyLimit(env, cors);
          if (limited) return limited;

          const body = await request.json();
          if (!ALLOWED_CLAUDE_MODEL.test(String(body.model || ''))) {
            return errorJson(400, `このサーバーでは ${body.model} は使用できません。`, cors);
          }
          body.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP);

          return await proxy(
            'https://api.anthropic.com/v1/messages',
            { method: 'POST', headers: anthropicHeaders(env), body: JSON.stringify(body) },
            cors
          );
        }

        case 'GET /openai/models':
          return await proxy(
            'https://api.openai.com/v1/models',
            { method: 'GET', headers: openaiHeaders(env) },
            cors
          );

        case 'POST /openai/images': {
          const limited = await checkDailyLimit(env, cors);
          if (limited) return limited;

          const body = await request.json();
          if (!ALLOWED_IMAGE_MODEL.test(String(body.model || ''))) {
            return errorJson(400, `このサーバーでは ${body.model} は使用できません。`, cors);
          }

          return await proxy(
            'https://api.openai.com/v1/images/generations',
            { method: 'POST', headers: openaiHeaders(env), body: JSON.stringify(body) },
            cors
          );
        }

        // 動作確認用。ブラウザで開くとキーが登録済みかどうかだけ分かる
        case 'GET /health':
          return jsonResponse(200, {
            ok: true,
            anthropic_key: Boolean(env.ANTHROPIC_API_KEY),
            openai_key: Boolean(env.OPENAI_API_KEY),
            daily_limit: env.COUNTER ? dailyLimit(env) : '無効（KV未設定）',
          }, cors);

        default:
          return errorJson(404, '不明なリクエスト先です。', cors);
      }
    } catch (e) {
      console.error(e);
      return errorJson(500, '中継サーバーでエラーが発生しました。', cors);
    }
  },
};

// ── 本家APIへ転送し、応答をそのまま返す ──
async function proxy(url, init, cors) {
  const upstream = await fetch(url, init);
  const headers = new Headers(cors);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  // 応答本文は解析せずそのまま流す（画像のbase64が大きくても負荷にならない）
  return new Response(upstream.body, { status: upstream.status, headers });
}

function anthropicHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };
}

function openaiHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
  };
}

// ── CORS（どのサイトからの呼び出しを許可するか） ──
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowed.includes('*')) headers['Access-Control-Allow-Origin'] = '*';
  else if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

// ── 1日あたりの呼び出し上限（KVを紐付けた場合のみ有効） ──
function dailyLimit(env) {
  return Number(env.DAILY_LIMIT) || 500;
}

// 日本時間での日付（0時リセット）
function jstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function checkDailyLimit(env, cors) {
  if (!env.COUNTER) return null; // KV未設定なら上限なしで通す

  const limit = dailyLimit(env);
  const key = 'count:' + jstDate();
  const used = Number(await env.COUNTER.get(key)) || 0;

  if (used >= limit) {
    // 上限到達後は書き込みをせず、読み取りだけで弾く
    return errorJson(429, `本日の利用上限（${limit}回）に達しました。明日またお試しください。`, cors);
  }

  // 2日後に自動削除（古いカウンターを残さない）
  await env.COUNTER.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return null;
}

// ── 応答のヘルパー ──
function jsonResponse(status, obj, cors) {
  const headers = new Headers(cors);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(obj), { status, headers });
}

function errorJson(status, message, cors) {
  return jsonResponse(status, { error: { message } }, cors);
}
