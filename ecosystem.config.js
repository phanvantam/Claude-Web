module.exports = {
  apps: [
    {
      name: 'claude-web-backend-dev',
      script: 'npm',
      args: 'run dev',
      cwd: './backend',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
    {
      name: 'claude-web-frontend-dev',
      script: 'npm',
      args: 'run dev',
      cwd: './frontend',
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'claude-web-backend-prod',
      script: 'npm',
      args: 'start',
      cwd: './backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
