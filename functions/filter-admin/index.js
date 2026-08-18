export async function onRequest(context) {
  // Fetch filter.html from the same Pages deployment
  const url = new URL(context.request.url);
  url.pathname = '/filter.html';
  const response = await fetch(url.toString());
  const html = await response.text();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}
