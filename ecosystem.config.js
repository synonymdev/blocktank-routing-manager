'use strict'

const DEBUG_FLAG = 'LH:*'

const settings = {
  ignore_watch: 'status',
  watch: ['./src', './*js']
}

module.exports = {
  apps: [
    {
      name: 'ln:router',
      script: './start.js',
      env: {
        DEBUG: DEBUG_FLAG
      },
      env_production: {},
      ...settings
    }
  ]
}
