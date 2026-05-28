export const healthRoutes = async (app) => {
    app.get('/health', async () => ({ status: 'ok', service: 'mai-dashboard' }));
};
