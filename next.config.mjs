// API_URL is set only on the live website (Vercel): it is the address of the backend (Render). The browser keeps
// calling /api on the website's own address, and Vercel forwards those calls to the backend, so the login cookie
// stays on one domain and no CORS is needed. Leave it unset to run everything in one app (local, desktop, Render).
const api = process.env.API_URL?.replace(/\/$/, '');

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // Check builds use NEXT_DIST_DIR so they never overwrite the .next folder a running `next dev` is serving.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return api ? { beforeFiles: [{ source: '/api/:path*', destination: `${api}/api/:path*` }] } : [];
  },
};
