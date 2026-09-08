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
    if (path === 'items' && request.method === 'PUT') { await kv.put('items', JSON.stringify(await request.json())); return json({ ok:true }); }
    if (path === 'lists' && request.method === 'PUT') {
      const b = await request.json();
      await kv.put('clients', JSON.stringify(b.clients||[]));
      await kv.put('cats', JSON.stringify(b.cats||[]));
      return json({ ok:true });
    }

    // ---- Albums (team) ----
    if (path === 'albums' && request.method === 'GET') { return json({ albums: (await kv.get('albums','json'))||[] }); }
    if (path === 'albums' && request.method === 'PUT') { await kv.put('albums', JSON.stringify(await request.json())); return json({ ok:true }); }

    // ---- Album (client, PIN gated) ----
    if (path === 'album' && request.method === 'GET') {
      const id = url.searchParams.get('id'); const pin = url.searchParams.get('pin') || '';
      const albums = (await kv.get('albums','json'))||[];
      const a = albums.find(x => x.id === id);
      if (!a) return json({ error:'notfound' }, 404);
      if ((a.pin||'') !== pin) return json({ error:'pin' }, 403);
      const items = (await kv.get('items','json'))||[];
      const byId = {}; items.forEach(i => byId[i.id] = i);
      const entries = (a.entries||[]).map(e => {
        const it = byId[e.itemId] || {};
        return { itemId: e.itemId, clientNote: e.clientNote||'',
          platform: it.platform, embedId: it.embedId, shortcode: it.shortcode, url: it.url, short: it.short, mtype: it.mtype, cover: it.cover||'',
          feedback: (a.feedback && a.feedback[e.itemId]) || { status:'', comments:[] } };
      });
      return json({ name: a.name, intro: a.intro||'', entries });
    }
    if (path === 'album-feedback' && request.method === 'POST') {
      const b = await request.json();
      const albums = (await kv.get('albums','json'))||[];
      const a = albums.find(x => x.id === b.id);
      if (!a) return json({ error:'notfound' }, 404);
      if ((a.pin||'') !== (b.pin||'')) return json({ error:'pin' }, 403);
      a.feedback = a.feedback || {};
      a.feedback[b.itemId] = a.feedback[b.itemId] || { status:'', comments:[] };
      if (b.status !== undefined) a.feedback[b.itemId].status = b.status;
      if (b.comment) a.feedback[b.itemId].comments.push({ t: b.comment, by: b.by||'Client', d: new Date().toISOString() });
      await kv.put('albums', JSON.stringify(albums));
      return json({ ok:true, feedback: a.feedback[b.itemId] });
    }

    // ---- Link preview ----
    if (path === 'preview' && request.method === 'GET') {
      const target = url.searchParams.get('url');
      if (!target) return json({ image:'' });
      const cacheKey = 'og:' + target;
      const cached = await kv.get(cacheKey);
      if (cached) return json({ image: cached });
      let image = await grab(target);
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
