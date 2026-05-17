import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev UI work: open ReviewPage immediately (`App.jsx` also redirects `/` → `/review` in DEV).
    open: '/review',
  },
})
