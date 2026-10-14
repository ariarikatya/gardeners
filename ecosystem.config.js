module.exports = {
  apps: [
    {
      name: 'anemon',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        UPLOADS_DIR: '/opt/anemon/uploads'
      }
    }
  ]
};
