module.exports = {
  apps: [
    {
      name: 'ws',
      script: 'dist/src/main.js', // Run compiled JS directly (more secure, no npm overhead)
      cwd: __dirname,
      instances: 'max', // MediaSoup workers are CPU-bound, manage scaling via mediasoup config
      exec_mode: 'fork', // Use fork mode for MediaSoup (cluster mode not recommended)
      watch: false,
      max_memory_restart: '1G',

      // SECURITY: Don't expose env vars in config - load from .env file
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      env_staging: {
        NODE_ENV: 'staging',
      },

      // Logging - use absolute paths in production
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_type: 'json', // Structured logging for production

      // Graceful shutdown
      kill_timeout: 10000, // 10 seconds for graceful shutdown
      wait_ready: true,
      listen_timeout: 30000,

      // Restart policy - more conservative for production
      autorestart: true,
      max_restarts: 5, // Reduced to prevent restart loops
      min_uptime: '30s', // Increased to detect crash loops
      restart_delay: 5000,
      exp_backoff_restart_delay: 500, // Exponential backoff on crashes

      // SECURITY: Disable source maps in production
      source_map_support: false,

      // SECURITY: Node.js security flags
      node_args: [
        '--no-deprecation',
        '--max-old-space-size=1024',
        // Uncomment for extra security (may break some features):
        // '--disallow-code-generation-from-strings',
      ].join(' '),

      // SECURITY: Don't expose internal errors
      combine_logs: true,
    },
  ],

  // Deployment configuration
  // SECURITY: Use environment variables for sensitive data
  deploy: {
    production: {
      user: process.env.DEPLOY_USER || 'deploy',
      host: process.env.DEPLOY_HOST ? [process.env.DEPLOY_HOST] : [],
      ref: 'origin/main',
      repo: process.env.DEPLOY_REPO || '',
      path: process.env.DEPLOY_PATH || '/var/www/aladin-chat',
      'pre-deploy-local': '',
      'post-deploy': 'npm ci --production && npm run build:prod && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      ssh_options: 'StrictHostKeyChecking=yes', // SECURITY: Enable strict host checking
    },
    staging: {
      user: process.env.DEPLOY_USER || 'deploy',
      host: process.env.DEPLOY_HOST_STAGING ? [process.env.DEPLOY_HOST_STAGING] : [],
      ref: 'origin/develop',
      repo: process.env.DEPLOY_REPO || '',
      path: process.env.DEPLOY_PATH_STAGING || '/var/www/aladin-chat-staging',
      'post-deploy': 'npm ci --production && npm run build:prod && pm2 reload ecosystem.config.js --env staging',
      ssh_options: 'StrictHostKeyChecking=yes', // SECURITY: Enable strict host checking
    },
  },
};
