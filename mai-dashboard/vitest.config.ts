import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts (which drives the production frontend build) so test
// runs get the React plugin's JSX handling without pulling in build-only settings.
export default defineConfig({
  plugins: [react()],
});
