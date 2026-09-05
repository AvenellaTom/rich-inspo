// RICH Inspiration Library - API (Cloudflare Pages Functions + KV)
// Binding required: KV namespace bound as LIBRARY (set in the dashboard or wrangler.toml)

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  const kv = env.LIBRARY;

  try {
    if (!kv) return json({ error: 'KV namespace LIBRARY is not bound. Add the binding and redeploy.' }, 500);

    // Load everything
    if (path === 'data' && request.method === 'GET') {
      const [items, clients, cats] = await Promise.all([
        kv.get('items', 'json'), kv.get('clients', 'json'), kv.get('cats', 'json')
      ]);
      return json({ items: items || [], clients: clients || [], cats: cats || [] });
    }

    // Save the whole items array (last write wins - fine for a small team)
    if (path === 'items' && request.method === 'PUT') {
      const body = await request.json();
      await kv.put('items', JSON.stringify(body));
      return json({ ok: true });
    }

    // Save client + category lists
    if (path === 'lists' && request.method === 'PUT') {
      const body = await request.json();
      await kv.put('clients', JSON.stringify(body.clients || []));
      await kv.put('cats', JSON.stringify(body.cats || []));
      return json({ ok: true });
    }

    // Fetch a link's preview image (Open Graph), cached in KV
    if (path === 'preview' && request.method === 'GET') {
      const target = url.searchParams.get('url');
      if (!target) return json({ image: '' });
      const cacheKey = 'og:' + target;
      const cached = await kv.get(cacheKey);
      if (cached !== null) return json({ image: cached });
      let image = '';
      try {
        const res = await fetch(target, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; RICHInspoBot/1.0)', 'accept': 'text/html' },
          cf: { cacheTtl: 3600 }
        });
        const html = await res.text();
        const m = html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
               || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
        if (m) image = m[1].replace(/&amp;/g, '&');
      } catch (e) { /* ignore, return empty */ }
      await kv.put(cacheKey, image, { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ image });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
