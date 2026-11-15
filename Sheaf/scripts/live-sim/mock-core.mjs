export const WebView = {
  getServerBasePath: async () => ({ path: globalThis.SIM.basePath }),
  setServerBasePath: async ({ path }) => { globalThis.SIM.basePath = path; globalThis.SIM.reloads++; },
  persistServerBasePath: async () => { globalThis.SIM.persisted = globalThis.SIM.basePath; },
};
