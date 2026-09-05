// RICH Inspiration Library - API (Cloudflare Pages Functions + KV)
// Binding required: KV namespace bound as LIBRARY

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const kv = env.LIBRARY;
  try {
    if (!kv) return json({ error: 'KV namespace LIBRARY is not bound.' }, 500);

    if (path === 'data' && request.method === 'GET') {
      const [items, clients, cats] = await Promise.all([
        kv.get('items','json'), kv.get('clients','json'), kv.get('cats','json')]);
      return json({ items: items||[], clients: clients||[], cats: cats||[] });
    }
    if (path === 'items' && request.method === 'PUT') {
      await kv.put('items', JSON.stringify(await request.json())); return json({ ok:true });
    }
    if (path === 'lists' && request.method === 'PUT') {
      const b = await request.json();
      await kv.put('clients', JSON.stringify(b.clients||[]));
      await kv.put('cats', JSON.stringify(b.cats||[]));
      return json({ ok:true });
    }
    if (path === 'preview' && request.method === 'GET') {
      const target = url.searchParams.get('url');
      if (!target) return json({ image:'' });
      const cacheKey = 'og:' + target;
      const cached = await kv.get(cacheKey);
      if (cached) return json({ image: cached });        // only trust non-empty cache

      let image = await grab(target);
      // Instagram blocks the main page server-side; its embed page usually has the image
      if (!image && /instagram\.com/i.test(target)) {
        const m = target.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
        if (m) image = await grab('https://www.instagram.com/p/' + m[1] + '/embed/captioned');
      }
      const isIG = /instagram\.com/i.test(target);
      await kv.put(cacheKey, image, { expirationTtl: image ? (isIG ? 86400 : 2592000) : 1800 });
      return json({ image });
    }
    return json({ error:'Not found' }, 404);
  } catch (e) { return json({ error:String(e) }, 500); }
}

async function grab(u) {
  try {
    const r = await fetch(u, { headers:{ 'user-agent':UA, 'accept':'text/html,*/*' }, cf:{ cacheTtl:1800 } });
    const html = await r.text();
    const m = html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)
           || html.match(/"display_url":"([^"]+)"/)
           || html.match(/class=["']EmbeddedMediaImage["'][^>]*src=["']([^"']+)["']/i);
    if (m) return m[1].replace(/\\u0026/g,'&').replace(/\\\//g,'/').replace(/&amp;/g,'&');
  } catch (e) {}
  return '';
}

function json(o, s=200){ return new Response(JSON.stringify(o), { status:s, headers:JSON_HEADERS }); }
