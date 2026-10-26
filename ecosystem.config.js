module.exports = {
  apps: [
    {
      name: 'anemon',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      autorestart: true,
      max_memory_restart: '800M',
      exp_backoff_restart_delay: 100,
      listen_timeout: 10000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        UPLOADS_DIR: '/opt/anemon/uploads'
      }
    }
  ]
};
