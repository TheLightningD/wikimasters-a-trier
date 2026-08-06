module.exports = env => env.GITHUB_ACTIONS === 'true' ? { args: ['--no-sandbox'] } : {};
