let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = import('../backend/dist/app.js')
      .catch(() => import('../backend/src/app.js'))
      .then((module) => module.default || module);
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}

