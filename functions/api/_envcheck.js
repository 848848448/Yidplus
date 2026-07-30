// TEMP diagnostic — reports only WHETHER these vars are set (never the values),
// so we can see what the deployed environment actually has. Remove after.
export async function onRequestGet(context) {
  const { env } = context;
  const set = (v) => !!(v && String(v).length);
  return new Response(JSON.stringify({
    PRIVATE_BOT_TOKEN: set(env.PRIVATE_BOT_TOKEN),
    PRIVATE_BOT_WEBHOOK_SECRET: set(env.PRIVATE_BOT_WEBHOOK_SECRET),
    TELEGRAM_BOT_TOKEN: set(env.TELEGRAM_BOT_TOKEN),
    TG_BOT_TOKEN: set(env.TG_BOT_TOKEN),
    deployed_at: new Date().toISOString(),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
