const appPromise = import('../backend/src/app.js').then((module) => module.default || module);

export default async function handler(req, res) {
  const app = await appPromise;
  return app(req, res);
}
