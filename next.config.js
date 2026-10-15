/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This CLI runs in a child process, so its files cannot be inferred by tracing.
  outputFileTracingIncludes: {
    '/api/convert-fbx-to-vrma': [
      './node_modules/fbx2vrma-converter/**',
      './node_modules/fs-extra/**',
      './node_modules/graceful-fs/**',
      './node_modules/jsonfile/**',
      './node_modules/universalify/**',
      './node_modules/commander/**',
    ],
  },
}

module.exports = nextConfig
