export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Something went wrong</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; }
      h1 { font-size: 1.125rem; margin: 0 0 0.5rem; }
      p { color: #888; margin: 0 0 1.5rem; font-size: 0.875rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; }
      a, button { padding: 0.4rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; font-size: 0.875rem; }
      .primary { background: #fafafa; color: #0a0a0a; }
      .secondary { background: transparent; color: #fafafa; border-color: #333; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred. Try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
