// Public configuration only. Private signing key never leaves the runtime.
export async function onRequestGet({ env }) {
  const ready = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  return new Response(JSON.stringify({ ok: ready, public_key: ready ? env.VAPID_PUBLIC_KEY : null }), { status: ready ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
