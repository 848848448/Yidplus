export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const host = url.hostname;

  // If request is on filter.yidplus.com and not an API call
  if (host === 'filter.yidplus.com') {
    const path = url.pathname;

    // API calls pass through normally
    if (path.startsWith('/filter/')) {
      return next();
    }

    // Everything else → serve filter.html
    const filterUrl = new URL(request.url);
    filterUrl.pathname = '/filter.html';
    const newRequest = new Request(filterUrl.toString(), request);
    return next(newRequest);
  }

  return next();
}
