import 'server-only';

// Relays VWorld base map tiles so the API key stays on the server.
// Set VWORLD_API_KEY (and VWORLD_DOMAIN, the registered domain) in .env.local and on Vercel.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; y: string; x: string }> },
) {
  const { z, y, x } = await params;
  if (![z, y, x].every((part) => /^\d+$/.test(part)) || Number(z) > 19) {
    return new Response('Invalid tile', { status: 400 });
  }

  const key = process.env.VWORLD_API_KEY;
  if (!key) return new Response('VWORLD_API_KEY is not set', { status: 500 });

  const domain = process.env.VWORLD_DOMAIN;
  const upstream = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/${z}/${y}/${x}.png`, {
    headers: domain ? { Referer: domain } : undefined,
    cache: 'force-cache',
  });
  if (!upstream.ok) return new Response(`VWorld responded ${upstream.status}`, { status: 502 });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
