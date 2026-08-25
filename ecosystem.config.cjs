module.exports = {
  apps: [
    {
      name: 'weex-momentum-bot',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000
    }
  ]
};
