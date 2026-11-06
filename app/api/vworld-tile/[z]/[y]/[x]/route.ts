import 'server-only';

// Image formats of the VWorld WMTS layers this app may show. Anything else is refused,
// so the route cannot be used to fetch arbitrary VWorld data.
const TILE_LAYERS: Record<string, string> = {
  Base: 'png',
  Satellite: 'jpeg',
};

// Relays VWorld map tiles so the API key stays on the server.
// Set VWORLD_API_KEY (and VWORLD_DOMAIN, the registered domain) in .env.local and on Vercel.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ z: string; y: string; x: string }> },
) {
  const { z, y, x } = await params;
  if (![z, y, x].every((part) => /^\d+$/.test(part)) || Number(z) > 19) {
    return new Response('Invalid tile', { status: 400 });
  }

  const layer = new URL(request.url).searchParams.get('layer') ?? 'Base';
  const extension = TILE_LAYERS[layer];
  if (!extension) return new Response('Unknown layer', { status: 400 });

  const key = process.env.VWORLD_API_KEY;
  if (!key) return new Response('VWORLD_API_KEY is not set', { status: 500 });

  const domain = process.env.VWORLD_DOMAIN;
  let upstream: Response;
  try {
    upstream = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/${z}/${y}/${x}.${extension}`, {
      headers: domain ? { Referer: domain } : undefined,
      cache: 'force-cache',
    });
  } catch (error) {
    // Report the reason in the response so the browser shows it; the key is not part of the message
    const reason = error instanceof Error ? `${error.message}${error.cause ? `: ${String(error.cause)}` : ''}` : 'unknown';
    console.error(`[terrain] fetch failed for ${layer} ${z}/${y}/${x}: ${reason}`);
    return new Response(`VWorld request failed: ${reason}`, { status: 502 });
  }
  if (!upstream.ok) return new Response(`VWorld responded ${upstream.status}`, { status: 502 });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
