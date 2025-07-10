const nextConfig = {
  webpack(config, { isServer }) {
    // WASM support
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };

    // WASM loader rule
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    // Optional: Fixes "Module not found" errors for WASM in serverless environments
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
  // For Next.js 13+
  experimental: {
    serverComponentsExternalPackages: ['@dqbd/tiktoken'],
  }
};

module.exports = nextConfig;
