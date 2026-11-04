let appPromise;

export default async function handler(req, res) {
  if (!appPromise) {
    appPromise = import('../backend/src/app.js').then((module) => module.default || module);
  }
  const app = await appPromise;
  return app(req, res);
}
